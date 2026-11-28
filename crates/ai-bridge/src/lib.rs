pub mod auth;
pub mod cli;
pub mod config;
pub mod runner;
pub mod usage;

use std::{sync::Arc, time::Instant};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tower_http::trace::TraceLayer;

use crate::{
    auth::{bearer_auth_middleware, BearerAuthPolicy},
    config::RoutingMode,
    runner::{BridgeRouter, CompleteRequest},
    usage::{cli_available, read_claude_usage},
};

#[derive(Clone)]
pub struct BridgeState {
    pub router: Arc<BridgeRouter>,
}

pub fn build_bridge_app(state: BridgeState) -> Router {
    let auth_policy = BearerAuthPolicy::new(state.router.config.bearer_token.clone());

    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/complete", post(v1_complete))
        .route("/v1/usage", get(v1_usage))
        .layer(axum::middleware::from_fn_with_state(
            auth_policy,
            bearer_auth_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Unauthenticated: reports only booleans, never resolved paths (they contain the username).
async fn healthz(State(state): State<BridgeState>) -> Json<serde_json::Value> {
    let cfg = &state.router.config;
    let path = std::env::var("PATH").ok();
    let claude = cli_available(&cfg.claude_bin, path.as_deref());
    let agy = cli_available(&cfg.agy_bin, path.as_deref());
    let primary_ok = match cfg.default_routing_mode {
        RoutingMode::Auto => claude || agy,
        RoutingMode::PreferClaude => claude,
        RoutingMode::PreferAgy => agy,
    };
    Json(serde_json::json!({
        "status": if primary_ok { "ok" } else { "degraded" },
        "service": "career-os-ai-bridge",
        "routing_mode": cfg.default_routing_mode.as_str(),
        "primary_provider": cfg.primary_provider.as_str(),
        "providers": {
            "claude": { "available": claude },
            "agy": { "available": agy }
        }
    }))
}

async fn v1_complete(
    State(state): State<BridgeState>,
    body: Result<Json<CompleteRequest>, JsonRejection>,
) -> Response {
    let req = match body {
        Ok(Json(req)) => req,
        Err(rej) => {
            return error_response(StatusCode::BAD_REQUEST, "BAD_REQUEST", &rej.body_text());
        }
    };
    match state.router.complete(req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(err) => {
            let (status, code) = err.status_and_code();
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            error_response(status, code, &err.to_string())
        }
    }
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": message, "code": code })),
    )
        .into_response()
}

async fn v1_usage(State(state): State<BridgeState>) -> Json<serde_json::Value> {
    let cfg = &state.router.config;
    let claude = match &cfg.claude_statusline_path {
        Some(path) => Some(read_claude_usage(path, cfg.statusline_max_age_secs).await),
        None => None,
    };
    let stats = state.router.metrics.lock().await.snapshot(Instant::now());
    Json(serde_json::json!({
        "routing_mode": cfg.default_routing_mode.as_str(),
        "primary_provider": cfg.primary_provider.as_str(),
        "claude": claude,
        "metrics": stats
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::BridgeConfig,
        runner::{BoxFuture, CliInvokeError, CliInvokeOutput, CliRunner, InvokeRequest},
    };
    use tokio::net::TcpListener;

    struct OkRunner;
    impl CliRunner for OkRunner {
        fn invoke<'a>(
            &'a self,
            req: InvokeRequest<'a>,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            Box::pin(async move {
                Ok(CliInvokeOutput {
                    content: "ok".to_string(),
                    model: req.model.to_string(),
                    latency_ms: 5,
                    prompt_tokens: None,
                    completion_tokens: None,
                    cost_usd: None,
                })
            })
        }
    }

    #[tokio::test]
    async fn bridge_http_enforces_bearer_auth() {
        let cfg = BridgeConfig {
            bearer_token: Some("test-bridge-secret".to_string()),
            ..BridgeConfig::default()
        };
        let state = BridgeState {
            router: Arc::new(BridgeRouter::new(cfg, Arc::new(OkRunner))),
        };
        let app = build_bridge_app(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::new();
        let base = format!("http://{addr}");

        // /healthz exempt
        let hz = client.get(format!("{base}/healthz")).send().await.unwrap();
        assert_eq!(hz.status(), reqwest::StatusCode::OK);

        // /v1/usage without token -> 401
        let unauth = client.get(format!("{base}/v1/usage")).send().await.unwrap();
        assert_eq!(unauth.status(), reqwest::StatusCode::UNAUTHORIZED);

        // /v1/complete with valid token -> 200 (accepts both new and legacy tier names)
        let ok = client
            .post(format!("{base}/v1/complete"))
            .bearer_auth("test-bridge-secret")
            .json(&serde_json::json!({
                "tier": "fast",
                "prompt": "hello"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), reqwest::StatusCode::OK);
        let ok_legacy = client
            .post(format!("{base}/v1/complete"))
            .bearer_auth("test-bridge-secret")
            .json(&serde_json::json!({
                "tier": "hydrogen",
                "prompt": "hello legacy"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok_legacy.status(), reqwest::StatusCode::OK);
    }

    struct RateLimitedRunner;
    impl CliRunner for RateLimitedRunner {
        fn invoke<'a>(
            &'a self,
            _req: InvokeRequest<'a>,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            Box::pin(async { Err(CliInvokeError::RateLimited("429".into())) })
        }
    }

    async fn serve(runner: Arc<dyn CliRunner>) -> String {
        let cfg = BridgeConfig {
            bearer_token: Some("test-bridge-secret".to_string()),
            ..BridgeConfig::default()
        };
        let app = build_bridge_app(BridgeState {
            router: Arc::new(BridgeRouter::new(cfg, runner)),
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn bad_body_is_json_400() {
        let base = serve(Arc::new(OkRunner)).await;
        let client = reqwest::Client::new();
        for body in [
            r#"{"tier":"balanced"}"#,
            "not json",
            r#"{"tier":"balanced","prompt":"p","primary":"codex"}"#,
        ] {
            let resp = client
                .post(format!("{base}/v1/complete"))
                .bearer_auth("test-bridge-secret")
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), reqwest::StatusCode::BAD_REQUEST, "{body}");
            let json: serde_json::Value = resp.json().await.unwrap();
            assert_eq!(json["code"], "BAD_REQUEST");
            assert!(json["error"].as_str().is_some_and(|e| !e.is_empty()));
        }
    }

    #[tokio::test]
    async fn upstream_rate_limit_is_429_with_code() {
        let base = serve(Arc::new(RateLimitedRunner)).await;
        let resp = reqwest::Client::new()
            .post(format!("{base}/v1/complete"))
            .bearer_auth("test-bridge-secret")
            .json(&serde_json::json!({ "tier": "balanced", "prompt": "p" }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
        let json: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(json["code"], "RATE_LIMITED");
    }

    #[tokio::test]
    async fn unauthorized_has_code() {
        let base = serve(Arc::new(OkRunner)).await;
        let resp = reqwest::Client::new()
            .post(format!("{base}/v1/complete"))
            .bearer_auth("wrong")
            .json(&serde_json::json!({ "tier": "balanced", "prompt": "p" }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
        let json: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(json["code"], "UNAUTHORIZED");
    }

    #[tokio::test]
    async fn healthz_reports_provider_availability_without_paths() {
        let base = serve(Arc::new(OkRunner)).await;
        let json: serde_json::Value = reqwest::get(format!("{base}/healthz"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(json["providers"]["claude"]["available"].is_boolean());
        assert!(json["providers"]["agy"]["available"].is_boolean());
        assert!(!json.to_string().contains('/'), "{json}");
    }

    #[tokio::test]
    async fn usage_returns_typed_claude_windows() {
        let dir = std::env::temp_dir().join(format!("career-os-usage-http-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("statusline.json");
        std::fs::write(&p, include_str!("../tests/fixtures/claude_statusline.json")).unwrap();
        let cfg = BridgeConfig {
            bearer_token: Some("test-bridge-secret".to_string()),
            claude_statusline_path: Some(p),
            ..BridgeConfig::default()
        };
        let app = build_bridge_app(BridgeState {
            router: Arc::new(BridgeRouter::new(cfg, Arc::new(OkRunner))),
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let json: serde_json::Value = reqwest::Client::new()
            .get(format!("http://{addr}/v1/usage"))
            .bearer_auth("test-bridge-secret")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(json["claude"]["five_hour"]["used_percentage"], 23.5);
        assert_eq!(json["claude"]["seven_day"]["resets_at"], 1_790_400_000);
        assert_eq!(json["claude"]["stale"], false);
        assert_eq!(json["routing_mode"], "auto");
        assert!(json["metrics"]["providers"]["agy"].is_object());
        assert!(!json.to_string().contains("your-user"));
        let _ = std::fs::remove_dir_all(&dir);

        // Unconfigured statusline => claude: null.
        let base = serve(Arc::new(OkRunner)).await;
        let json: serde_json::Value = reqwest::Client::new()
            .get(format!("{base}/v1/usage"))
            .bearer_auth("test-bridge-secret")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(json["claude"].is_null());
    }
}
