use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};

#[derive(Debug, Clone)]
pub struct BearerAuthPolicy {
    pub expected_token: Option<String>,
}

impl BearerAuthPolicy {
    pub fn new(token: Option<String>) -> Self {
        Self {
            expected_token: token
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        }
    }
}

pub fn verify_bearer_header(
    policy: &BearerAuthPolicy,
    path: &str,
    auth_header: Option<&str>,
) -> bool {
    if path == "/healthz" {
        return true;
    }

    let Some(expected) = policy.expected_token.as_deref() else {
        return false; // Fail closed if no bearer token is configured on bridge
    };

    let Some(raw_header) = auth_header else {
        return false;
    };

    let Some(token) = raw_header
        .strip_prefix("Bearer ")
        .or_else(|| raw_header.strip_prefix("bearer "))
    else {
        return false;
    };

    constant_time_eq(token.trim().as_bytes(), expected.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub async fn bearer_auth_middleware(
    State(policy): State<BearerAuthPolicy>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    let auth_header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    if verify_bearer_header(&policy, path, auth_header) {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "missing or invalid bearer token",
                "code": "UNAUTHORIZED"
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_verification_is_fail_closed() {
        let no_token = BearerAuthPolicy::new(None);
        assert!(verify_bearer_header(&no_token, "/healthz", None));
        assert!(!verify_bearer_header(
            &no_token,
            "/v1/complete",
            Some("Bearer anything")
        ));

        let policy = BearerAuthPolicy::new(Some("bridge-secret-123".to_string()));
        assert!(verify_bearer_header(&policy, "/healthz", None));
        assert!(!verify_bearer_header(&policy, "/v1/complete", None));
        assert!(!verify_bearer_header(
            &policy,
            "/v1/complete",
            Some("Basic abc")
        ));
        assert!(!verify_bearer_header(
            &policy,
            "/v1/complete",
            Some("Bearer wrong")
        ));
        assert!(verify_bearer_header(
            &policy,
            "/v1/complete",
            Some("Bearer bridge-secret-123")
        ));
    }
}
