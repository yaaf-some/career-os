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
pub mod sync;

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
            sync_lock: Default::default(),
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

    async fn serve_with(
        ai: Arc<dyn crate::ai::AiProvider>,
    ) -> (String, sqlx::SqlitePool, AppState) {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        let state = AppState {
            pool: pool.clone(),
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                ..AppConfig::default()
            }),
            ai,
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
        };
        let app = build_router(state.clone());
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
        (format!("http://{addr}"), pool, state)
    }

    async fn ingest_one(client: &reqwest::Client, base: &str) -> String {
        let res: serde_json::Value = client
            .post(format!("{base}/api/jobs/ingest"))
            .json(&serde_json::json!({ "jobs": [{
                "url": "https://example.com/jobs/202",
                "company": "Example Corp",
                "title": "Platform Engineer",
                "jd_text": "Run Rust services."
            }]}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(res["ingested"], 1);
        let list: serde_json::Value = client
            .get(format!("{base}/api/jobs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        list["jobs"][0]["id"].as_str().unwrap().to_string()
    }

    async fn count(pool: &sqlx::SqlitePool, sql: &'static str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    /// AC6: no bridge configured ⇒ AI routes 503, nothing written, scheduler skips scoring.
    #[tokio::test]
    async fn disabled_ai_returns_503_and_writes_nothing() {
        let (base, pool, state) = serve_with(Arc::new(crate::ai::DisabledAiProvider)).await;
        let client = reqwest::Client::new();
        let job_id = ingest_one(&client, &base).await;

        for (path, body) in [
            (
                "/api/ai/score-pending".to_string(),
                serde_json::json!({"limit": 5}),
            ),
            (
                format!("/api/ai/evaluate/{job_id}"),
                serde_json::json!({"tier": "neon"}),
            ),
        ] {
            let resp = client
                .post(format!("{base}{path}"))
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(
                resp.status(),
                reqwest::StatusCode::SERVICE_UNAVAILABLE,
                "{path}"
            );
            let json: serde_json::Value = resp.json().await.unwrap();
            assert_eq!(json["code"], "SERVICE_UNAVAILABLE");
        }

        crate::scheduler::run_hourly_scoring(&state).await.unwrap();

        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM ai_usage_events").await,
            0
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM evaluations").await, 0);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM jobs WHERE triage_status = 'pending_scoring'"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM sync_runs WHERE run_type = 'tier1_score'"
            )
            .await,
            0
        );

        let usage: serde_json::Value = client
            .get(format!("{base}/api/ai/usage"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(usage["configured"], false);
        assert_eq!(usage["claudeStale"], true);
    }

    /// AC7 + AC10 + routing passthrough, through the real HostBridgeProvider.
    #[tokio::test]
    async fn bridge_routing_cost_and_error_passthrough() {
        use crate::ai::fake_bridge::{self, Mode};

        let (bridge_url, fake) = fake_bridge::start(Mode::Ok).await;
        let provider = Arc::new(crate::ai::HostBridgeProvider::new(
            bridge_url,
            fake_bridge::TOKEN.into(),
        ));
        let (base, pool, _) = serve_with(provider).await;
        let client = reqwest::Client::new();
        let job_id = ingest_one(&client, &base).await;

        // Invalid routing is rejected; valid routing is used by both tiers.
        let bad = client
            .put(format!("{base}/api/settings/ai_routing"))
            .json(&serde_json::json!({"value": {"hydrogenPrimary": "codex", "neonPrimary": "claude", "autoFailover": true}}))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);
        let ok = client
            .put(format!("{base}/api/settings/ai_routing"))
            .json(&serde_json::json!({"value": {"hydrogenPrimary": "agy", "neonPrimary": "claude", "autoFailover": false}}))
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), reqwest::StatusCode::OK);

        let score: serde_json::Value = client
            .post(format!("{base}/api/ai/score-pending"))
            .json(&serde_json::json!({"limit": 5}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(score["scored"], 1);
        let eval = client
            .post(format!("{base}/api/ai/evaluate/{job_id}"))
            .json(&serde_json::json!({"tier": "neon"}))
            .send()
            .await
            .unwrap();
        assert_eq!(eval.status(), reqwest::StatusCode::OK);

        {
            let reqs = fake.requests.lock().unwrap();
            assert_eq!(reqs.len(), 2);
            assert_eq!(
                (reqs[0]["tier"].as_str(), reqs[0]["primary"].as_str()),
                (Some("hydrogen"), Some("agy"))
            );
            assert_eq!(
                (reqs[1]["tier"].as_str(), reqs[1]["primary"].as_str()),
                (Some("neon"), Some("claude"))
            );
            assert!(reqs.iter().all(|r| r["allow_failover"] == false));
        }

        // AC10: tokens + cost + provider persisted.
        let (pt, ct, cost): (Option<i64>, Option<i64>, Option<f64>) = sqlx::query_as(
            "SELECT prompt_tokens, completion_tokens, cost_usd FROM ai_usage_events WHERE tier = 'neon'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((pt, ct, cost), (Some(120), Some(45), Some(0.0123)));
        let eval_provider: Option<String> = sqlx::query_scalar("SELECT provider FROM evaluations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(eval_provider.as_deref(), Some("claude"));
        let detail: serde_json::Value = client
            .get(format!("{base}/api/jobs/{job_id}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["evaluations"][0]["provider"], "claude");

        // agy 24 h count comes from recorded rows.
        let usage: serde_json::Value = client
            .get(format!("{base}/api/ai/usage"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(usage["configured"], true);
        assert_eq!(usage["bridgeReachable"], true);
        assert_eq!(usage["antigravity"]["callsUsed"], 1);
        assert_eq!(usage["claude5h"]["percentUsed"], 10.0);

        // AC7: bridge 429 / 504 surface as API 429 / 504.
        for (status, code, expect) in [
            (
                429u16,
                "RATE_LIMITED",
                reqwest::StatusCode::TOO_MANY_REQUESTS,
            ),
            (504, "TIMED_OUT", reqwest::StatusCode::GATEWAY_TIMEOUT),
        ] {
            *fake.mode.lock().unwrap() = Mode::Fail(status, code);
            let resp = client
                .post(format!("{base}/api/ai/evaluate/{job_id}"))
                .json(&serde_json::json!({"tier": "neon"}))
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), expect);
        }
    }
}
