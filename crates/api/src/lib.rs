pub mod ai;
pub mod config;
pub mod crypto;
pub mod db;
pub mod error;
pub mod integrations;
pub mod middleware;
pub mod openapi;
pub mod routes;
pub mod scheduler;
pub mod state;

use axum::{
    http::HeaderValue,
    routing::{get, patch, post, put},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    middleware::auth::{tailscale_auth_middleware, AuthPolicy},
    openapi::ApiDoc,
    state::AppState,
};

pub fn build_router(state: AppState) -> Router {
    let auth_policy = AuthPolicy::new(
        state.config.allowed_tailscale_user.clone(),
        state.config.exempt_local_google_callback,
    );

    let api_router = Router::new()
        .route("/healthz", get(routes::health::healthz))
        .route("/api/jobs", get(routes::jobs::list_jobs))
        .route("/api/jobs/{id}", get(routes::jobs::get_job))
        .route(
            "/api/jobs/{id}/commute",
            get(routes::commute::get_job_commute),
        )
        .route(
            "/api/commute/preview",
            post(routes::commute::preview_commute),
        )
        .route("/api/jobs/ingest", post(routes::jobs::ingest_jobs))
        .route("/api/triage/{id}", post(routes::triage::triage_job))
        .route("/api/triage/batch", post(routes::triage::triage_batch))
        .route("/api/applications", get(routes::tracker::list_applications))
        .route(
            "/api/applications/{id}",
            patch(routes::tracker::update_application),
        )
        .route("/api/tracker/stats", get(routes::tracker::tracker_stats))
        .route(
            "/api/sources",
            get(routes::sources::list_sources).post(routes::sources::create_source),
        )
        .route(
            "/api/sources/{id}",
            patch(routes::sources::update_source).delete(routes::sources::delete_source),
        )
        .route("/api/sources/scan", post(routes::sources::trigger_scan))
        .route(
            "/api/ai/score-pending",
            post(routes::ai::score_pending_jobs),
        )
        .route("/api/ai/evaluate/{job_id}", post(routes::ai::evaluate_job))
        .route("/api/ai/usage", get(routes::ai::get_ai_usage))
        .route(
            "/api/auth/google/status",
            get(routes::auth::google_auth_status),
        )
        .route("/api/auth/google/url", get(routes::auth::google_auth_url))
        .route(
            "/api/auth/google/callback",
            get(routes::auth::google_auth_callback),
        )
        .route(
            "/api/auth/google/disconnect",
            post(routes::auth::google_auth_disconnect),
        )
        .route("/api/settings", get(routes::settings::list_settings))
        .route("/api/settings/{key}", put(routes::settings::upsert_setting))
        .route("/api/sync-runs", get(routes::settings::list_sync_runs))
        .merge(SwaggerUi::new("/docs").url("/api/openapi.json", ApiDoc::openapi()));

    let mut router = if let Some(static_dir) = &state.config.static_dir {
        let index_path = format!("{}/index.html", static_dir.trim_end_matches('/'));
        let serve = ServeDir::new(static_dir).fallback(ServeFile::new(index_path));
        api_router.fallback_service(serve)
    } else {
        api_router
    };

    if let Some(origin) = &state.config.cors_origin {
        if let Ok(header_val) = origin.parse::<HeaderValue>() {
            let cors = CorsLayer::new()
                .allow_origin(header_val)
                .allow_methods(Any)
                .allow_headers(Any);
            router = router.layer(cors);
        }
    }

    router
        .layer(axum::middleware::from_fn_with_state(
            auth_policy,
            tailscale_auth_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, sync::Arc};

    use tokio::net::TcpListener;

    use crate::{
        ai::MockAiProvider,
        config::AppConfig,
        db::init_pool,
        integrations::{
            calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, maps::MapsClient,
            scanner::ScannerClient,
        },
    };

    use super::*;

    #[tokio::test]
    async fn end_to_end_pipeline_ingest_score_triage_evaluate() {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        let state = AppState {
            pool,
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                ..AppConfig::default()
            }),
            ai: Arc::new(MockAiProvider),
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
        };

        let app = build_router(state);
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

        // 1. Health check
        let health = client.get(format!("{base}/healthz")).send().await.unwrap();
        assert_eq!(health.status(), reqwest::StatusCode::OK);

        // 2. Ingest job
        let ingest_res: serde_json::Value = client
            .post(format!("{base}/api/jobs/ingest"))
            .json(&serde_json::json!({
                "jobs": [{
                    "url": "https://example.com/jobs/101?utm_source=test",
                    "company": "Example Corp",
                    "title": "Senior Rust Engineer",
                    "location": "Remote",
                    "workplace_type": "remote",
                    "jd_text": "Build high-reliability Rust services."
                }]
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(ingest_res["ingested"], 1);

        // 3. Score pending via MockAiProvider (hydrogen)
        let score_res: serde_json::Value = client
            .post(format!("{base}/api/ai/score-pending"))
            .json(&serde_json::json!({ "limit": 10 }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(score_res["scored"], 1);

        // 4. Fetch job ID
        let list_res: serde_json::Value = client
            .get(format!("{base}/api/jobs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let job_id = list_res["jobs"][0]["id"].as_str().unwrap().to_string();

        // 5. Shortlist triage
        let triage_res: serde_json::Value = client
            .post(format!("{base}/api/triage/{job_id}"))
            .json(&serde_json::json!({ "action": "shortlist" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(triage_res["triage_status"], "shortlisted");
        assert!(triage_res["application_id"].is_string());

        // 6. Deep evaluate (neon)
        let eval_res: serde_json::Value = client
            .post(format!("{base}/api/ai/evaluate/{job_id}"))
            .json(&serde_json::json!({ "tier": "neon" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(eval_res["evaluation_id"].is_string());

        // 7. Tracker stats
        let stats_res: serde_json::Value = client
            .get(format!("{base}/api/tracker/stats"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(stats_res["by_application_stage"][0]["count"], 1);
    }
}
