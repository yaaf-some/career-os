pub mod ai;
pub mod config;
pub mod crypto;
pub mod db;
pub mod error;
pub mod integrations;
pub mod middleware;
pub mod openapi;
pub mod profile;
pub mod routes;
pub mod scheduler;
pub mod state;
pub mod sync;

use axum::{http::HeaderValue, Router};
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    middleware::auth::{tailscale_auth_middleware, AuthPolicy},
    state::AppState,
};

pub fn build_router(state: AppState) -> Router {
    let auth_policy = AuthPolicy::new(
        state.config.allowed_tailscale_user.clone(),
        state.config.exempt_local_google_callback,
    );

    let api_router = routes::api_router()
        .merge(SwaggerUi::new("/docs").url("/api/openapi.json", openapi::spec()));

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
            state.config.cors_origin.clone(),
            middleware::csrf::same_origin_writes,
        ))
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

    use axum::routing::get;

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
            linear: None,
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

        // 3. Score pending via MockAiProvider (fast)
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

        // 6. Deep evaluate (auto-escalates >= 75 to deep)
        let eval_res: serde_json::Value = client
            .post(format!("{base}/api/ai/evaluate/{job_id}"))
            .json(&serde_json::json!({}))
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

    async fn serve_with_config(
        ai: Arc<dyn crate::ai::AiProvider>,
        config: AppConfig,
    ) -> (String, sqlx::SqlitePool, AppState) {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        let state = AppState {
            pool: pool.clone(),
            config: Arc::new(config),
            ai,
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
            linear: None,
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

    async fn serve_with(
        ai: Arc<dyn crate::ai::AiProvider>,
    ) -> (String, sqlx::SqlitePool, AppState) {
        serve_with_config(
            ai,
            AppConfig {
                scheduler_enabled: false,
                ..AppConfig::default()
            },
        )
        .await
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
            (format!("/api/ai/evaluate/{job_id}"), serde_json::json!({})),
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

        // Invalid routing is rejected; valid routing and auto >= 75 escalation work cleanly.
        let bad = client
            .put(format!("{base}/api/settings/ai_routing"))
            .json(&serde_json::json!({"value": {"mode": "codex"}}))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);
        let ok = client
            .put(format!("{base}/api/settings/ai_routing"))
            .json(&serde_json::json!({"value": {"mode": "prefer_agy"}}))
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

        // Update tier1_score=80 so evaluate_job auto-escalates to deep; fake bridge scores >= 75 -> deep.
        let eval: serde_json::Value = client
            .post(format!("{base}/api/ai/evaluate/{job_id}"))
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(eval["tier"], "deep");

        // A job scored below 75 stays on balanced tier.
        sqlx::query("INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, tier1_score) VALUES ('job-mid', 'mid-key', 'https://example.com/mid', 'MidCo', 'Platform Eng', 'manual', 'pending_triage', 62.0)")
            .execute(&pool)
            .await
            .unwrap();
        let eval_mid: serde_json::Value = client
            .post(format!("{base}/api/ai/evaluate/job-mid"))
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(eval_mid["tier"], "balanced");

        {
            let reqs = fake.requests.lock().unwrap();
            assert_eq!(reqs.len(), 3);
            assert_eq!(
                (reqs[0]["tier"].as_str(), reqs[0]["routing_mode"].as_str()),
                (Some("fast"), Some("prefer_agy"))
            );
            assert_eq!(
                (reqs[1]["tier"].as_str(), reqs[1]["routing_mode"].as_str()),
                (Some("deep"), Some("prefer_agy"))
            );
            assert_eq!(
                (reqs[2]["tier"].as_str(), reqs[2]["routing_mode"].as_str()),
                (Some("balanced"), Some("prefer_agy"))
            );
            assert!(reqs.iter().all(|r| r["allow_failover"] == true));
        }

        // AC10: tokens + cost + provider persisted.
        let (pt, ct, cost): (Option<i64>, Option<i64>, Option<f64>) = sqlx::query_as(
            "SELECT prompt_tokens, completion_tokens, cost_usd FROM ai_usage_events WHERE tier = 'deep'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((pt, ct, cost), (Some(120), Some(45), Some(0.0123)));
        let eval_provider: Option<String> =
            sqlx::query_scalar("SELECT provider FROM evaluations WHERE job_id = ?1")
                .bind(&job_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(eval_provider.as_deref(), Some("agy"));
        let detail: serde_json::Value = client
            .get(format!("{base}/api/jobs/{job_id}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["evaluations"][0]["provider"], "agy");

        // agy 24 h count comes from recorded rows (all 3 calls used agy under prefer_agy).
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
        assert_eq!(usage["antigravity"]["callsUsed"], 3);
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
                .json(&serde_json::json!({}))
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), expect);
        }
    }

    #[tokio::test]
    async fn quick_add_tracker_patch_sync_and_link() {
        let (base, pool, state) = serve_with(Arc::new(MockAiProvider)).await;
        let client = reqwest::Client::new();

        // AC4: quick-add derives title/company, dedupes by canonical URL.
        let added: serde_json::Value = client
            .post(format!("{base}/api/jobs"))
            .json(&serde_json::json!({"url": "https://jobs.example-co.com/careers/staff-platform-engineer/123?utm_source=x"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(added["company"], "Example Co");
        assert_eq!(added["title"], "Staff Platform Engineer");
        assert_eq!(added["triage_status"], "pending_scoring");
        assert_eq!(added["source_type"], "manual");
        let job_id = added["id"].as_str().unwrap().to_string();
        let again: serde_json::Value = client
            .post(format!("{base}/api/jobs"))
            .json(&serde_json::json!({"url": "https://jobs.example-co.com/careers/staff-platform-engineer/123", "title": "Other"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(again["id"], job_id.as_str());
        let bad = client
            .post(format!("{base}/api/jobs"))
            .json(&serde_json::json!({"url": "javascript:alert(1)"}))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

        // AC3: PATCH creates the application, sets stage/applied_at/follow-up/notes.
        let tracker: serde_json::Value = client
            .patch(format!("{base}/api/tracker"))
            .json(&serde_json::json!({
                "jobId": job_id, "stage": "applied",
                "nextFollowUpAt": "2026-12-01T09:00:00Z", "notes": "Referred by a friend"
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let entry = &tracker["entries"][0];
        assert_eq!(entry["stage"], "applied");
        assert_eq!(entry["nextFollowUpAt"], "2026-12-01T09:00:00Z");
        assert_eq!(entry["notes"], "Referred by a friend");
        let applied_at: Option<String> =
            sqlx::query_scalar("SELECT applied_at FROM applications WHERE job_id = ?1")
                .bind(&job_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(applied_at.is_some());
        // Absent field = unchanged; null = cleared.
        let kept: serde_json::Value = client
            .patch(format!("{base}/api/tracker"))
            .json(&serde_json::json!({"jobId": job_id, "notes": "Updated"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(kept["entries"][0]["nextFollowUpAt"], "2026-12-01T09:00:00Z");
        let cleared: serde_json::Value = client
            .patch(format!("{base}/api/tracker"))
            .json(&serde_json::json!({"jobId": job_id, "nextFollowUpAt": null}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(cleared["entries"][0]["nextFollowUpAt"].is_null());
        assert_eq!(cleared["entries"][0]["notes"], "Updated");
        for (body, status) in [
            (
                serde_json::json!({"jobId": job_id, "stage": "hired"}),
                reqwest::StatusCode::BAD_REQUEST,
            ),
            (
                serde_json::json!({"jobId": "nope"}),
                reqwest::StatusCode::NOT_FOUND,
            ),
        ] {
            let resp = client
                .patch(format!("{base}/api/tracker"))
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), status);
        }

        // Manual link survives a relink and shows up in job detail.
        let app_id: String = sqlx::query_scalar("SELECT id FROM applications WHERE job_id = ?1")
            .bind(&job_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO gmail_threads (id, thread_id, subject, from_email, snippet, needs_reply) VALUES ('t1','g1','Coffee chat?','pat@example.org','Hi there',1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let linked: serde_json::Value = client
            .put(format!("{base}/api/gmail-threads/t1/application"))
            .json(&serde_json::json!({"applicationId": app_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(linked["linkSource"], "manual");
        crate::sync::link::relink_all(&pool).await.unwrap();
        let detail: serde_json::Value = client
            .get(format!("{base}/api/jobs/{job_id}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["gmail_threads"][0]["subject"], "Coffee chat?");
        assert_eq!(detail["gmail_threads"][0]["needs_reply"], true);
        let missing = client
            .put(format!("{base}/api/gmail-threads/t1/application"))
            .json(&serde_json::json!({"applicationId": "nope"}))
            .send()
            .await
            .unwrap();
        assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);

        // AC7: sync now needs Google; an in-flight sync blocks a second one.
        let resp = client
            .post(format!("{base}/api/sync/google"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::CONFLICT);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["code"], "GOOGLE_NOT_CONNECTED");
        let guard = state.sync_lock.lock().await;
        let err = crate::scheduler::run_google_sync(&state).await.unwrap_err();
        assert_eq!(err.status_and_code().1, "SYNC_IN_PROGRESS");
        drop(guard);
        let run = crate::scheduler::run_google_sync(&state).await.unwrap();
        assert_eq!(run.run_type, "gmail_sync");
        assert_eq!(run.status, "succeeded");
    }

    #[tokio::test]
    async fn profile_status_personalized_prompts_and_rescore() {
        use crate::ai::fake_bridge::{self, Mode};

        let dir = std::env::temp_dir().join(format!("api-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("profile/projects")).unwrap();
        std::fs::write(
            dir.join("profile/targeting.yml"),
            "schema_version: 1\nstatus: verified\nroles:\n  primary: [\"Platform Engineer\"]\nscoring_weights:\n  role_stack: 35\n  level_reachability: 25\n  vibe_culture: 25\n  logistics_comp: 15\nhard_dealbreakers:\n  - \"No aerospace hardware\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("profile/skills.yml"),
            "status: verified\nstrong_production:\n  infra: [\"Kubernetes\", \"ArgoCD\"]\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("profile/projects/demo.md"),
            "---\nslug: demo\nname: \"Demo Platform\"\nstatus: verified\n---\n\n## One-Liner\nSelf-serve platform proof.\n",
        )
        .unwrap();

        let (bridge_url, fake) = fake_bridge::start(Mode::Ok).await;
        let provider = Arc::new(crate::ai::HostBridgeProvider::new(
            bridge_url,
            fake_bridge::TOKEN.into(),
        ));
        let (base, pool, _) = serve_with_config(
            provider,
            AppConfig {
                scheduler_enabled: false,
                data_dir: dir.clone(),
                ..AppConfig::default()
            },
        )
        .await;
        let client = reqwest::Client::new();

        // 1. Profile status reports loaded profile metadata.
        let status: serde_json::Value = client
            .get(format!("{base}/api/profile/status"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(status["loaded"], true);
        assert_eq!(status["targeting"]["primaryRoles"][0], "Platform Engineer");
        assert_eq!(status["targeting"]["dealbreakerCount"], 1);

        // 2. Seed jobs across statuses: pending_triage (unapplied), skipped (unapplied),
        //    shortlisted (with application), blacklisted.
        for sql in [
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, tier1_score, tier1_json) VALUES \
             ('j-triage','k1','https://example.com/1','Example Co','Platform Engineer','manual','pending_triage',70.0,'{}'), \
             ('j-skip','k2','https://example.com/2','Example Co','DevOps Engineer','manual','skipped',30.0,'{}'), \
             ('j-short','k3','https://example.com/3','Example Co','SRE','manual','shortlisted',88.0,'{}'), \
             ('j-black','k4','https://example.com/4','Example Co','Old Role','manual','blacklisted',20.0,'{}')",
            "INSERT INTO applications (id, job_id, stage) VALUES ('a1', 'j-short', 'applied')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }

        // 3. Rescore only pending_triage (includeSkipped=false), scoring 1 batch immediately.
        let rescore: serde_json::Value = client
            .post(format!("{base}/api/ai/rescore"))
            .json(&serde_json::json!({"includeSkipped": false, "scoreLimit": 5}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(rescore["resetCount"], 1);
        assert_eq!(rescore["scored"], 1);

        // Skipped, applied/shortlisted, and blacklisted remain untouched.
        let skip_status: String =
            sqlx::query_scalar("SELECT triage_status FROM jobs WHERE id = 'j-skip'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(skip_status, "skipped");
        let short_score: Option<f64> =
            sqlx::query_scalar("SELECT tier1_score FROM jobs WHERE id = 'j-short'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(short_score, Some(88.0));

        // 4. Persisted tier1_json includes breakdown, and fast scoring prompt used loaded profile.
        let tier1_raw: String =
            sqlx::query_scalar("SELECT tier1_json FROM jobs WHERE id = 'j-triage'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let tier1_val: serde_json::Value = serde_json::from_str(&tier1_raw).unwrap();
        assert_eq!(tier1_val["breakdown"]["role_stack"], 30.0);

        // 5. Deep evaluation also receives the compiled dossier (and auto-escalates >= 75).
        let eval_resp = client
            .post(format!("{base}/api/ai/evaluate/j-triage"))
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(eval_resp.status(), reqwest::StatusCode::OK);

        {
            let reqs = fake.requests.lock().unwrap();
            assert_eq!(reqs.len(), 2);
            let h_prompt = reqs[0]["prompt"].as_str().unwrap();
            assert!(h_prompt.contains("No aerospace hardware"));
            assert!(h_prompt.contains("Demo Platform"));
            assert!(!h_prompt.contains("Senior systems/backend engineer"));
            let n_prompt = reqs[1]["prompt"].as_str().unwrap();
            assert!(n_prompt.contains("Self-serve platform proof."));
        }

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn drive_project_docs_sync_digests_once_and_feeds_prompts() {
        use std::{collections::HashMap, sync::Mutex};

        use axum::{extract::Query, http::StatusCode, response::IntoResponse};

        use crate::{
            ai::fake_bridge::{self, Mode},
            crypto::TokenCipher,
            integrations::google_auth::{store_google_tokens, GoogleTokenResponse},
        };

        let mod_time = Arc::new(Mutex::new("2026-11-28T10:00:00Z".to_string()));
        let doc_text = Arc::new(Mutex::new(
            "# Migration Report\n\nReduced latency by 40%.".to_string(),
        ));
        let export_calls = Arc::new(Mutex::new(0usize));

        let mt = mod_time.clone();
        let dt = doc_text.clone();
        let ec = export_calls.clone();

        let drive_app = Router::new()
            .route(
                "/files",
                get(move |Query(q): Query<HashMap<String, String>>| {
                    let mt = mt.clone();
                    async move {
                        assert!(q.get("q").unwrap().contains("'proj-folder-1' in parents"));
                        axum::Json(serde_json::json!({
                            "files": [{
                                "id": "gdoc-1",
                                "name": "Migration Report",
                                "webViewLink": "https://docs.google.com/document/d/gdoc-1/edit",
                                "mimeType": "application/vnd.google-apps.document",
                                "modifiedTime": *mt.lock().unwrap()
                            }, {
                                "id": "pdf-ignore",
                                "name": "Ignore.pdf",
                                "mimeType": "application/pdf"
                            }]
                        }))
                    }
                }),
            )
            .route(
                "/files/gdoc-1/export",
                get(move |Query(q): Query<HashMap<String, String>>| {
                    let dt = dt.clone();
                    let ec = ec.clone();
                    async move {
                        if q.get("mimeType").map(String::as_str) == Some("text/markdown") {
                            *ec.lock().unwrap() += 1;
                            dt.lock().unwrap().clone().into_response()
                        } else {
                            StatusCode::BAD_REQUEST.into_response()
                        }
                    }
                }),
            );

        let drive_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let drive_addr = drive_listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(drive_listener, drive_app).await.unwrap() });
        let drive_base = format!("http://{drive_addr}");

        let dir = std::env::temp_dir().join(format!("api-docs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("profile")).unwrap();
        std::fs::write(
            dir.join("profile/targeting.yml"),
            "schema_version: 1\nstatus: verified\nroles:\n  primary: [\"Platform Engineer\"]\n",
        )
        .unwrap();

        let (bridge_url, fake) = fake_bridge::start(Mode::Ok).await;
        let pool = init_pool("sqlite::memory:").await.unwrap();
        let cipher =
            TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        store_google_tokens(
            &pool,
            &cipher,
            Some("you@example.com"),
            &GoogleTokenResponse {
                access_token: "test-access".into(),
                refresh_token: None,
                expires_in: Some(3600),
                token_type: Some("Bearer".into()),
                scope: Some("https://www.googleapis.com/auth/drive.readonly".into()),
            },
        )
        .await
        .unwrap();

        let state = AppState {
            pool: pool.clone(),
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                data_dir: dir.clone(),
                google_drive_projects_folder_id: Some("proj-folder-1".into()),
                ..AppConfig::default()
            }),
            ai: Arc::new(crate::ai::HostBridgeProvider::new(
                bridge_url,
                fake_bridge::TOKEN.into(),
            )),
            cipher: Some(cipher),
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new().with_bases(drive_base.clone(), drive_base),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
            linear: None,
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
        let base = format!("http://{addr}");
        let client = reqwest::Client::new();

        // First sync exports and runs Hydrogen digest once.
        let s1: serde_json::Value = client
            .post(format!("{base}/api/profile/sync-docs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(s1["docsSynced"], 1);
        assert_eq!(s1["docsDigested"], 1);
        assert_eq!(s1["skippedUnchanged"], 0);
        assert_eq!(*export_calls.lock().unwrap(), 1);
        assert_eq!(fake.requests.lock().unwrap().len(), 1);

        // Second sync with unchanged modifiedTime skips export and AI digest.
        let s2: serde_json::Value = client
            .post(format!("{base}/api/profile/sync-docs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(s2["docsSynced"], 0);
        assert_eq!(s2["docsDigested"], 0);
        assert_eq!(s2["skippedUnchanged"], 1);
        assert_eq!(*export_calls.lock().unwrap(), 1);
        assert_eq!(fake.requests.lock().unwrap().len(), 1);

        // Updated modifiedTime re-exports and refreshes digest.
        *mod_time.lock().unwrap() = "2026-11-28T11:00:00Z".into();
        *doc_text.lock().unwrap() = "# Migration Report\n\nReduced latency by 55%.".into();
        let s3: serde_json::Value = client
            .post(format!("{base}/api/profile/sync-docs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(s3["docsSynced"], 1);
        assert_eq!(s3["docsDigested"], 1);
        assert_eq!(*export_calls.lock().unwrap(), 2);

        // Profile status shows synced & digested doc.
        let status: serde_json::Value = client
            .get(format!("{base}/api/profile/status"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(status["driveProjectsFolderConfigured"], true);
        assert_eq!(status["projectDocs"][0]["title"], "Migration Report");
        assert_eq!(status["projectDocs"][0]["digested"], true);

        // Score & evaluate inject the doc digest and full raw markdown.
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, jd_text) VALUES \
             ('jd-1','kd1','https://example.com/jd1','Example Co','Platform Engineer','manual','pending_scoring','Build Kubernetes platforms.')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let _ = client
            .post(format!("{base}/api/ai/score-pending"))
            .json(&serde_json::json!({"limit": 5}))
            .send()
            .await
            .unwrap();
        let _ = client
            .post(format!("{base}/api/ai/evaluate/jd-1"))
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap();

        let reqs = fake.requests.lock().unwrap();
        assert_eq!(reqs.len(), 4);
        assert!(reqs[2]["prompt"]
            .as_str()
            .unwrap()
            .contains("Digest for Migration Report"));
        assert!(reqs[3]["prompt"]
            .as_str()
            .unwrap()
            .contains("Reduced latency by 55%."));

        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod workspace_foundation_tests {
    use crate::{
        ai::MockAiProvider, config::AppConfig, db::init_pool, integrations::scanner::ScannedJob,
        state::AppState,
    };

    #[tokio::test]
    async fn list_reports_stage_and_tags_hides_archived_and_verdicts_leave_history() {
        let state = AppState::for_test(
            init_pool("sqlite::memory:").await.unwrap(),
            AppConfig::default(),
            std::sync::Arc::new(MockAiProvider),
        );
        let job = |n: u8| ScannedJob {
            canonical_key: format!("k{n}"),
            url: format!("https://example.com/jobs/{n}"),
            company: "Example Co".into(),
            title: "Platform Engineer".into(),
            location: None,
            workplace_type: None,
            posted_at: None,
            source_type: "manual".into(),
            jd_text: None,
        };
        state
            .ingest_scanned_jobs(&[job(1), job(2)], None)
            .await
            .unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM jobs WHERE canonical_key = 'k1'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO job_tags (job_id, tag) VALUES (?1, 'remote, maybe'), (?1, 'a')")
            .bind(&id)
            .execute(&state.pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE jobs SET archived_at = '2026-11-01T00:00:00Z' WHERE canonical_key = 'k2'",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let app = crate::build_router(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });
        let client = reqwest::Client::new();
        client
            .post(format!("{base}/api/triage/{id}"))
            .json(&serde_json::json!({ "action": "shortlist" }))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();

        let list: serde_json::Value = client
            .get(format!("{base}/api/jobs"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(list["total"], 1);
        assert_eq!(list["jobs"][0]["application_stage"], "shortlisted");
        assert_eq!(list["jobs"][0]["tags_json"], r#"["a","remote, maybe"]"#);
        let all: serde_json::Value = client
            .get(format!("{base}/api/jobs?include_archived=true"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(all["total"], 2);

        let events: Vec<(String, Option<String>, String)> =
            sqlx::query_as("SELECT kind, from_value, to_value FROM job_events")
                .fetch_all(&state.pool)
                .await
                .unwrap();
        assert_eq!(
            events,
            [(
                "triage".into(),
                Some("pending_scoring".into()),
                "shortlisted".into()
            )]
        );
    }
}
