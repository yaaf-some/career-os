pub mod auth;
pub mod config;
pub mod runner;
pub mod usage;

use std::{sync::Arc, time::Instant};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tower_http::trace::TraceLayer;

use crate::{
    auth::{bearer_auth_middleware, BearerAuthPolicy},
    runner::{BridgeRouter, CliInvokeError, CompleteRequest},
    usage::read_statusline_file,
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

async fn healthz(State(state): State<BridgeState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "career-os-ai-bridge",
        "primary_provider": state.router.config.primary_provider.as_str()
    }))
}

async fn v1_complete(
    State(state): State<BridgeState>,
    Json(req): Json<CompleteRequest>,
) -> Response {
    match state.router.complete(req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(err) => {
            let status = match err {
                CliInvokeError::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
                CliInvokeError::TimedOut(_) => StatusCode::GATEWAY_TIMEOUT,
                CliInvokeError::ExecutionFailed(_) => StatusCode::BAD_GATEWAY,
            };
            (
                status,
                Json(serde_json::json!({
                    "error": err.to_string(),
                    "code": "BRIDGE_UPSTREAM_ERROR"
                })),
            )
                .into_response()
        }
    }
}

async fn v1_usage(State(state): State<BridgeState>) -> Json<serde_json::Value> {
    let statusline = match &state.router.config.claude_statusline_path {
        Some(path) => read_statusline_file(path).await,
        None => None,
    };

    let stats = state.router.metrics.lock().await.snapshot(Instant::now());
    Json(serde_json::json!({
        "primary_provider": state.router.config.primary_provider.as_str(),
        "statusline": statusline,
        "metrics": stats
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{BridgeConfig, CliProviderKind},
        runner::{BoxFuture, CliInvokeOutput, CliRunner},
    };
    use std::time::Duration;
    use tokio::net::TcpListener;

    struct OkRunner;
    impl CliRunner for OkRunner {
        fn invoke<'a>(
            &'a self,
            _provider: CliProviderKind,
            model: &'a str,
            _prompt: &'a str,
            _timeout: Duration,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            Box::pin(async move {
                Ok(CliInvokeOutput {
                    content: "ok".to_string(),
                    model: model.to_string(),
                    latency_ms: 5,
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

        // /v1/complete with valid token -> 200
        let ok = client
            .post(format!("{base}/v1/complete"))
            .bearer_auth("test-bridge-secret")
            .json(&serde_json::json!({
                "tier": "hydrogen",
                "prompt": "hello"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), reqwest::StatusCode::OK);
    }
}
