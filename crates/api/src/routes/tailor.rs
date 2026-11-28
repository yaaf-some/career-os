//! Tailored Resume & Cover Letter Google Docs (`POST /api/jobs/{id}/tailor`, JOB-12).

use std::time::Instant;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    ai::{
        build_tailor_prompt, parse_tailor_response, AiRequest, AiTier, TailorEvidenceBullet,
        TailorJobInput, AI_DISABLED_MESSAGE,
    },
    db::{new_id, now_iso},
    error::AppError,
    integrations::drive::{google_doc_edit_url, markdown_to_doc_html},
    routes::jobs::JobRecord,
    state::{AiUsageRecord, AppState},
};

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct TailorJobRequest {
    pub tier: Option<AiTier>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TailorJobResponse {
    pub job_id: String,
    pub tailor_run_id: String,
    pub tier: AiTier,
    pub provider: String,
    pub model: String,
    pub resume_doc_url: String,
    pub cover_letter_doc_url: String,
    pub generated_at: String,
    pub grounded_bullets: Vec<TailorEvidenceBullet>,
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/tailor",
    params(
        ("id" = String, Path, description = "Job UUID")
    ),
    request_body(content = Option<TailorJobRequest>, description = "Optional AI tier override (defaults to deep)"),
    responses(
        (status = 200, description = "Generated tailored Resume and Cover Letter Google Docs", body = TailorJobResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 409, description = "PROFILE_NOT_LOADED or GOOGLE_NOT_CONNECTED / GOOGLE_RECONNECT_REQUIRED", body = crate::error::ErrorResponse),
        (status = 503, description = "AI bridge unavailable or not configured", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn tailor_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    body: Option<Json<TailorJobRequest>>,
) -> Result<Json<TailorJobResponse>, AppError> {
    if !state.ai.is_enabled() {
        return Err(AppError::ServiceUnavailable(
            AI_DISABLED_MESSAGE.to_string(),
        ));
    }

    let job = sqlx::query_as::<_, JobRecord>(
        r#"
        SELECT id, canonical_key, url, company, title, location, workplace_type,
               yoe_min, yoe_max, yoe_label, salary_min, salary_max, salary_currency,
               posted_at, source_type, source_id, jd_text, guard_flags_json,
               triage_status, tier1_score, tier1_json, created_at, updated_at
        FROM jobs WHERE id = ?1
        "#,
    )
    .bind(&job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    let profile = crate::profile::load_profile(&state.config.data_dir);
    let raw_docs = state.load_project_docs_raw().await;
    let dossier = match profile.build_tailoring_dossier(&raw_docs, 24_000) {
        Some(d) => d,
        None if state.config.ai_demo_mode => "## Experience (source_file: profile/experience.md)\n\
             - Built and operated reliable platform systems (demo mode)."
            .to_string(),
        None => {
            return Err(AppError::ConflictCode(
                "PROFILE_NOT_LOADED",
                "Candidate profile is not loaded; mount DATA_DIR/profile before tailoring"
                    .to_string(),
            ));
        }
    };

    // Check Google auth before spending AI quota.
    let token = state.require_google_access_token().await?;

    let eval_summary: Option<String> = sqlx::query_scalar(
        "SELECT report_md FROM evaluations WHERE job_id = ?1 AND report_md IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&job_id)
    .fetch_optional(&state.pool)
    .await?;

    let req = body.map(|Json(r)| r).unwrap_or_default();
    let tier = req.tier.unwrap_or(AiTier::Deep);
    let (system_prompt, prompt) = build_tailor_prompt(
        &dossier,
        &TailorJobInput {
            id: job.id.clone(),
            company: job.company.clone(),
            title: job.title.clone(),
            location: job.location.clone(),
            jd_text: job.jd_text.unwrap_or_default(),
            eval_summary,
        },
    );

    let routing = state.ai_routing().await;
    let started = Instant::now();
    let ai_req = AiRequest {
        tier,
        system_prompt: Some(system_prompt),
        prompt,
        max_tokens: Some(6000),
        temperature: Some(0.2),
        json_mode: true,
        timeout_secs: Some(180),
        routing_mode: Some(routing.mode),
        primary: None,
        allow_failover: true,
    };

    let resp = match state.ai.complete(ai_req).await {
        Ok(r) => r,
        Err(err) => {
            let msg = err.to_string();
            let _ = state
                .record_ai_usage(AiUsageRecord::failure(
                    tier,
                    state.ai.name(),
                    started.elapsed().as_millis() as i64,
                    &msg,
                    Some(&job_id),
                ))
                .await;
            return Err(err);
        }
    };

    let _ = state
        .record_ai_usage(AiUsageRecord::success(tier, &resp, Some(&job_id)))
        .await;

    let parsed = parse_tailor_response(&resp.content)?;

    let resume_title = if parsed.resume_title == "Tailored Resume" {
        format!("Resume — {} — {}", job.company, job.title)
    } else {
        parsed.resume_title.clone()
    };
    let cover_title = if parsed.cover_letter_title == "Tailored Cover Letter" {
        format!("Cover Letter — {} — {}", job.company, job.title)
    } else {
        parsed.cover_letter_title.clone()
    };

    let resume_html = markdown_to_doc_html(&resume_title, &parsed.resume_markdown);
    let cover_html = markdown_to_doc_html(&cover_title, &parsed.cover_letter_markdown);
    let folder = state.config.google_drive_output_folder_id.as_deref();

    let resume_drive = state
        .drive
        .create_google_doc_from_html(&token, &resume_title, folder, &resume_html)
        .await?;
    let cover_drive = state
        .drive
        .create_google_doc_from_html(&token, &cover_title, folder, &cover_html)
        .await?;

    let resume_doc_url = google_doc_edit_url(&resume_drive);
    let cover_letter_doc_url = google_doc_edit_url(&cover_drive);

    let generated_at = now_iso();
    let resume_artifact_id = new_id();
    let cover_artifact_id = new_id();
    let tailor_run_id = new_id();
    let bullets_json = serde_json::to_string(&parsed.grounded_bullets)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let mut tx = state.pool.begin().await?;
    for (art_id, kind, file_id, url, title) in [
        (
            &resume_artifact_id,
            "resume_doc",
            &resume_drive.id,
            &resume_doc_url,
            &resume_title,
        ),
        (
            &cover_artifact_id,
            "cover_doc",
            &cover_drive.id,
            &cover_letter_doc_url,
            &cover_title,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO drive_artifacts (id, job_id, kind, drive_file_id, drive_url, title, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(art_id)
        .bind(&job_id)
        .bind(kind)
        .bind(file_id)
        .bind(url)
        .bind(title)
        .bind(&generated_at)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO tailor_runs (
            id, job_id, tier, provider, model, resume_artifact_id, cover_artifact_id,
            resume_md, cover_letter_md, grounded_bullets_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
    )
    .bind(&tailor_run_id)
    .bind(&job_id)
    .bind(tier.as_str())
    .bind(&resp.provider)
    .bind(&resp.model)
    .bind(&resume_artifact_id)
    .bind(&cover_artifact_id)
    .bind(&parsed.resume_markdown)
    .bind(&parsed.cover_letter_markdown)
    .bind(&bullets_json)
    .bind(&generated_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(TailorJobResponse {
        job_id,
        tailor_run_id,
        tier,
        provider: resp.provider,
        model: resp.model,
        resume_doc_url,
        cover_letter_doc_url,
        generated_at,
        grounded_bullets: parsed.grounded_bullets,
    }))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    use axum::{routing::post, Router};
    use tokio::net::TcpListener;

    use super::*;
    use crate::{
        ai::{
            AiProvider, AiResponse, AiUsageReport, BoxFuture, DisabledAiProvider, MockAiProvider,
        },
        config::AppConfig,
        crypto::TokenCipher,
        db::init_pool,
        integrations::{
            calendar::CalendarClient,
            drive::DriveClient,
            gmail::GmailClient,
            google_auth::{store_google_tokens, GoogleTokenResponse},
            maps::MapsClient,
            scanner::ScannerClient,
        },
        routes::jobs::get_job,
    };

    struct CountingMockAi {
        calls: Arc<AtomicUsize>,
    }

    impl AiProvider for CountingMockAi {
        fn name(&self) -> &'static str {
            "counting-mock"
        }

        fn complete<'a>(&'a self, req: AiRequest) -> BoxFuture<'a, Result<AiResponse, AppError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            MockAiProvider.complete(req)
        }

        fn usage<'a>(&'a self) -> BoxFuture<'a, Result<AiUsageReport, AppError>> {
            MockAiProvider.usage()
        }
    }

    fn synthetic_profile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("career-os-tailor-test-{}", new_id()));
        let profile = dir.join("profile");
        fs::create_dir_all(&profile).unwrap();
        fs::write(
            profile.join("experience.md"),
            "---\nstatus: verified\n---\n\n### Acme\n- Operated Kubernetes clusters.\n",
        )
        .unwrap();
        dir
    }

    async fn fake_drive() -> (String, Arc<Mutex<Vec<String>>>) {
        let count = Arc::new(AtomicUsize::new(0));
        let names = Arc::new(Mutex::new(Vec::new()));
        let count_c = count.clone();
        let names_c = names.clone();
        let app = Router::new().route(
            "/files",
            post(move |body: String| {
                let count_c = count_c.clone();
                let names_c = names_c.clone();
                async move {
                    let n = count_c.fetch_add(1, Ordering::SeqCst) + 1;
                    let id = format!("gdoc-{n}");
                    let kind = if body.contains("Candidate Resume") {
                        "resume"
                    } else {
                        "cover"
                    };
                    names_c.lock().unwrap().push(kind.to_string());
                    Json(serde_json::json!({
                        "id": id,
                        "name": format!("Doc {n}"),
                        "webViewLink": format!("https://docs.google.com/document/d/{id}/edit"),
                        "mimeType": "application/vnd.google-apps.document"
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}"), names)
    }

    async fn build_state(
        ai: Arc<dyn AiProvider>,
        drive_base: &str,
        data_dir: PathBuf,
        google_connected: bool,
    ) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, jd_text, source_type) VALUES
             ('job-1', 'k1', 'https://jobs.example.com/1', 'Example Co', 'Platform Engineer', 'Kubernetes and Rust.', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let cipher =
            TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        if google_connected {
            store_google_tokens(
                &pool,
                &cipher,
                Some("you@example.com"),
                &GoogleTokenResponse {
                    access_token: "tok".into(),
                    refresh_token: None,
                    expires_in: Some(3600),
                    token_type: Some("Bearer".into()),
                    scope: None,
                },
            )
            .await
            .unwrap();
        }

        AppState {
            pool,
            config: Arc::new(AppConfig {
                data_dir,
                scheduler_enabled: false,
                google_drive_output_folder_id: Some("out-dir-1".into()),
                ..AppConfig::default()
            }),
            ai,
            cipher: Some(cipher),
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new().with_bases(drive_base.into(), drive_base.into()),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
            linear: None,
        }
    }

    #[tokio::test]
    async fn tailor_fails_fast_before_calling_ai() {
        let (drive_base, _) = fake_drive().await;
        let profile_dir = synthetic_profile_dir();

        // 1. AI disabled -> 503
        let st_disabled = build_state(
            Arc::new(DisabledAiProvider),
            &drive_base,
            profile_dir.clone(),
            true,
        )
        .await;
        let err = tailor_job(State(st_disabled), Path("job-1".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().0.as_u16(), 503);

        // 2. Missing job -> 404 (0 AI calls)
        let calls = Arc::new(AtomicUsize::new(0));
        let ai = Arc::new(CountingMockAi {
            calls: calls.clone(),
        });
        let st_ok = build_state(ai.clone(), &drive_base, profile_dir.clone(), true).await;
        let err = tailor_job(State(st_ok), Path("missing".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().0.as_u16(), 404);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        // 3. Profile not loaded -> 409 PROFILE_NOT_LOADED (0 AI calls)
        let missing_profile = std::env::temp_dir().join(format!("missing-profile-{}", new_id()));
        let st_no_profile = build_state(ai.clone(), &drive_base, missing_profile, true).await;
        let err = tailor_job(State(st_no_profile), Path("job-1".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().1, "PROFILE_NOT_LOADED");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        // 4. Google not connected -> 409 GOOGLE_NOT_CONNECTED (0 AI calls)
        let st_no_google = build_state(ai, &drive_base, profile_dir.clone(), false).await;
        let err = tailor_job(State(st_no_google), Path("job-1".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().1, "GOOGLE_NOT_CONNECTED");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let _ = fs::remove_dir_all(profile_dir);
    }

    #[tokio::test]
    async fn tailor_generates_docs_persists_run_and_hydrates_job_detail() {
        let (drive_base, uploaded) = fake_drive().await;
        let profile_dir = synthetic_profile_dir();
        let calls = Arc::new(AtomicUsize::new(0));
        let ai = Arc::new(CountingMockAi {
            calls: calls.clone(),
        });
        let st = build_state(ai, &drive_base, profile_dir.clone(), true).await;

        let res = tailor_job(State(st.clone()), Path("job-1".into()), None)
            .await
            .unwrap()
            .0;

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(res.tier, AiTier::Deep);
        assert_eq!(
            res.resume_doc_url,
            "https://docs.google.com/document/d/gdoc-1/edit"
        );
        assert_eq!(
            res.cover_letter_doc_url,
            "https://docs.google.com/document/d/gdoc-2/edit"
        );
        assert_eq!(res.grounded_bullets.len(), 1);
        assert_eq!(uploaded.lock().unwrap().as_slice(), ["resume", "cover"]);

        let usage_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_usage_events WHERE job_id = 'job-1' AND tier = 'deep' AND success = 1",
        )
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!(usage_count, 1);

        let detail = get_job(State(st), Path("job-1".into())).await.unwrap().0;
        assert_eq!(detail.drive_artifacts.len(), 2);
        let latest = detail.latest_tailor.expect("latest_tailor hydrated");
        assert_eq!(latest.tier, "deep");
        assert_eq!(latest.grounded_bullets, res.grounded_bullets);

        let _ = fs::remove_dir_all(profile_dir);
    }
}
