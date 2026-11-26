use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::error::AppError;

pub const TAILSCALE_USER_HEADER: &str = "Tailscale-User-Login";
pub const GOOGLE_CALLBACK_PATH: &str = "/api/auth/google/callback";

#[derive(Debug, Clone)]
pub struct AuthPolicy {
    pub allowed_tailscale_user: Option<String>,
    pub exempt_local_google_callback: bool,
}

impl AuthPolicy {
    pub fn new(allowed_tailscale_user: Option<String>, exempt_local_google_callback: bool) -> Self {
        let normalized = allowed_tailscale_user
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Self {
            allowed_tailscale_user: normalized,
            exempt_local_google_callback,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthDecision {
    Allow,
    Unauthorized(&'static str),
    Forbidden(&'static str),
}

pub fn evaluate_auth(
    policy: &AuthPolicy,
    path: &str,
    remote_ip: Option<IpAddr>,
    tailscale_header: Option<&str>,
) -> AuthDecision {
    if path == "/healthz" {
        return AuthDecision::Allow;
    }

    if policy.exempt_local_google_callback
        && path == GOOGLE_CALLBACK_PATH
        && remote_ip.map(|ip| ip.is_loopback()).unwrap_or(false)
    {
        return AuthDecision::Allow;
    }

    let Some(expected_user) = policy.allowed_tailscale_user.as_deref() else {
        return AuthDecision::Allow;
    };

    let Some(actual_user) = tailscale_header.map(str::trim).filter(|s| !s.is_empty()) else {
        return AuthDecision::Unauthorized("missing Tailscale-User-Login header");
    };

    if actual_user.eq_ignore_ascii_case(expected_user) {
        AuthDecision::Allow
    } else {
        AuthDecision::Forbidden("Tailscale-User-Login does not match ALLOWED_TAILSCALE_USER")
    }
}

pub async fn tailscale_auth_middleware(
    State(policy): State<AuthPolicy>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let remote_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());
    let tailscale_header = req
        .headers()
        .get(TAILSCALE_USER_HEADER)
        .and_then(|v| v.to_str().ok());

    match evaluate_auth(&policy, &path, remote_ip, tailscale_header) {
        AuthDecision::Allow => next.run(req).await,
        AuthDecision::Unauthorized(msg) => AppError::Unauthorized(msg.to_string()).into_response(),
        AuthDecision::Forbidden(msg) => AppError::Forbidden(msg.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    use axum::{routing::get, Router};
    use tokio::net::TcpListener;

    #[test]
    fn unit_auth_decisions_fail_closed() {
        let policy = AuthPolicy::new(Some("alice@example.ts.net".to_string()), true);

        // /healthz always exempt
        assert_eq!(
            evaluate_auth(&policy, "/healthz", None, None),
            AuthDecision::Allow
        );

        // Missing header fails closed with Unauthorized
        assert!(matches!(
            evaluate_auth(&policy, "/api/jobs", None, None),
            AuthDecision::Unauthorized(_)
        ));

        // Empty header fails closed with Unauthorized
        assert!(matches!(
            evaluate_auth(&policy, "/api/jobs", None, Some("   ")),
            AuthDecision::Unauthorized(_)
        ));

        // Wrong user fails closed with Forbidden
        assert!(matches!(
            evaluate_auth(&policy, "/api/jobs", None, Some("bob@example.ts.net")),
            AuthDecision::Forbidden(_)
        ));

        // Case-insensitive match succeeds
        assert_eq!(
            evaluate_auth(&policy, "/api/jobs", None, Some("Alice@Example.ts.net")),
            AuthDecision::Allow
        );

        // Local 127.0.0.1 / ::1 callback exempt when configured
        assert_eq!(
            evaluate_auth(
                &policy,
                GOOGLE_CALLBACK_PATH,
                Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
                None
            ),
            AuthDecision::Allow
        );
        assert_eq!(
            evaluate_auth(
                &policy,
                GOOGLE_CALLBACK_PATH,
                Some(IpAddr::V6(Ipv6Addr::LOCALHOST)),
                None
            ),
            AuthDecision::Allow
        );

        // Non-loopback callback still requires Tailscale header
        assert!(matches!(
            evaluate_auth(
                &policy,
                GOOGLE_CALLBACK_PATH,
                Some(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 5))),
                None
            ),
            AuthDecision::Unauthorized(_)
        ));

        // Loopback callback fails closed if exemption disabled
        let strict_policy = AuthPolicy::new(Some("alice@example.ts.net".to_string()), false);
        assert!(matches!(
            evaluate_auth(
                &strict_policy,
                GOOGLE_CALLBACK_PATH,
                Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
                None
            ),
            AuthDecision::Unauthorized(_)
        ));

        // Unconfigured ALLOWED_TAILSCALE_USER allows local dev
        let open_policy = AuthPolicy::new(None, true);
        assert_eq!(
            evaluate_auth(&open_policy, "/api/jobs", None, None),
            AuthDecision::Allow
        );
    }

    #[tokio::test]
    async fn integration_tailscale_middleware_over_tcp() {
        let policy = AuthPolicy::new(Some("candidate@example.ts.net".to_string()), true);
        let app = Router::new()
            .route("/healthz", get(|| async { "ok" }))
            .route("/api/jobs", get(|| async { "jobs" }))
            .route("/api/auth/google/callback", get(|| async { "callback" }))
            .layer(axum::middleware::from_fn_with_state(
                policy,
                tailscale_auth_middleware,
            ));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });

        let client = reqwest::Client::new();
        let base = format!("http://{addr}");

        // /healthz exempt
        let res = client.get(format!("{base}/healthz")).send().await.unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);

        // /api/auth/google/callback exempt from 127.0.0.1
        let res = client
            .get(format!("{base}/api/auth/google/callback"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);

        // /api/jobs missing header -> 401
        let res = client.get(format!("{base}/api/jobs")).send().await.unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);

        // /api/jobs wrong user -> 403
        let res = client
            .get(format!("{base}/api/jobs"))
            .header(TAILSCALE_USER_HEADER, "intruder@example.ts.net")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);

        // /api/jobs valid user -> 200
        let res = client
            .get(format!("{base}/api/jobs"))
            .header(TAILSCALE_USER_HEADER, "candidate@example.ts.net")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);
    }
}
