use std::{sync::Arc, time::Instant};

use sqlx::SqlitePool;

use crate::{
    ai::{
        build_project_doc_digest_prompt, build_triage_batch_prompt,
        parse_project_doc_digest_response, parse_triage_batch_response, AiProvider, AiRequest,
        AiResponse, AiRouting, AiTier, ProjectDocDigest, TriageJobInput, TriageScoreItem,
        AI_DISABLED_MESSAGE, AI_ROUTING_KEY,
    },
    config::AppConfig,
    crypto::TokenCipher,
    db::{new_id, now_iso},
    error::AppError,
    integrations::{
        calendar::CalendarClient,
        drive::DriveClient,
        gmail::GmailClient,
        google_auth::{get_valid_google_access_token, GoogleOAuthClient},
        maps::MapsClient,
        scanner::ScannedJob,
    },
};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<AppConfig>,
    pub ai: Arc<dyn AiProvider>,
    pub cipher: Option<TokenCipher>,
    pub scanner: ScannerClientRef,
    pub gmail: GmailClient,
    pub drive: DriveClient,
    pub calendar: CalendarClient,
    pub maps: MapsClient,
    /// Held while a Google sync runs so scheduled and manual syncs never overlap.
    pub sync_lock: Arc<tokio::sync::Mutex<()>>,
    /// Set when `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are configured (JOB-6 PR C).
    pub linear: Option<crate::integrations::linear::LinearClient>,
}

pub type ScannerClientRef = crate::integrations::scanner::ScannerClient;

/// The scanner used to cut descriptions at 4,000 characters (slightly fewer
/// after the posting guard).
pub const TRUNCATED_DESCRIPTION: &str = "LENGTH(jd_text) BETWEEN 3900 AND 4000";

#[derive(Debug, Clone)]
pub struct IngestOutcome {
    pub ingested: i64,
    pub duplicates: i64,
}

/// One row of `ai_usage_events`.
#[derive(Debug, Clone)]
pub struct AiUsageRecord<'a> {
    pub tier: AiTier,
    pub provider: &'a str,
    pub model: &'a str,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub latency_ms: i64,
    pub success: bool,
    pub error_message: Option<&'a str>,
    pub job_id: Option<&'a str>,
}

impl<'a> AiUsageRecord<'a> {
    pub fn success(tier: AiTier, resp: &'a AiResponse, job_id: Option<&'a str>) -> Self {
        Self {
            tier,
            provider: &resp.provider,
            model: &resp.model,
            prompt_tokens: resp.prompt_tokens.map(i64::from),
            completion_tokens: resp.completion_tokens.map(i64::from),
            cost_usd: resp.cost_usd,
            latency_ms: resp.latency_ms as i64,
            success: true,
            error_message: None,
            job_id,
        }
    }

    /// The provider that failed isn't known here (the bridge tried one or two CLIs),
    /// so failures are recorded under the API-side provider name.
    pub fn failure(
        tier: AiTier,
        provider: &'a str,
        latency_ms: i64,
        error_message: &'a str,
        job_id: Option<&'a str>,
    ) -> Self {
        Self {
            tier,
            provider,
            model: "unknown",
            prompt_tokens: None,
            completion_tokens: None,
            cost_usd: None,
            latency_ms,
            success: false,
            error_message: Some(error_message),
            job_id,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProjectDocsSyncOutcome {
    pub docs_synced: i64,
    pub docs_digested: i64,
    pub skipped_unchanged: i64,
}

#[derive(Debug, Clone)]
pub struct ScoreBatchOutcome {
    pub scored: usize,
    pub items: Vec<TriageScoreItem>,
    pub provider: String,
    pub model: String,
}

impl AppState {
    pub fn build_google_oauth_client(&self) -> Option<GoogleOAuthClient> {
        let client_id = self.config.google_client_id.clone()?;
        let client_secret = self.config.google_client_secret.clone()?;
        let redirect_uri = self.config.google_redirect_uri.clone()?;
        Some(GoogleOAuthClient::new(
            client_id,
            client_secret,
            redirect_uri,
        ))
    }

    pub async fn ingest_scanned_jobs(
        &self,
        jobs: &[ScannedJob],
        source_id: Option<&str>,
    ) -> Result<IngestOutcome, AppError> {
        let mut ingested = 0_i64;
        let mut duplicates = 0_i64;

        for job in jobs {
            let id = new_id();
            let now = now_iso();
            let res = sqlx::query(
                r#"
                INSERT INTO jobs (
                    id, canonical_key, url, company, title, location, workplace_type,
                    posted_at, source_type, source_id, jd_text, triage_status, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending_scoring', ?12, ?12)
                ON CONFLICT(canonical_key) DO NOTHING
                "#,
            )
            .bind(&id)
            .bind(&job.canonical_key)
            .bind(&job.url)
            .bind(&job.company)
            .bind(&job.title)
            .bind(&job.location)
            .bind(&job.workplace_type)
            .bind(&job.posted_at)
            .bind(&job.source_type)
            .bind(source_id)
            .bind(&job.jd_text)
            .bind(&now)
            .execute(&self.pool)
            .await?;

            if res.rows_affected() > 0 {
                ingested += 1;
            } else {
                duplicates += 1;
                self.fill_missing_description(job).await?;
            }
        }

        Ok(IngestOutcome {
            ingested,
            duplicates,
        })
    }

    /// A re-seen posting fills in a description the saved job never had, or
    /// completes one that was cut off.
    async fn fill_missing_description(&self, job: &ScannedJob) -> Result<(), AppError> {
        let Some(text) = job.jd_text.as_deref().filter(|t| !t.trim().is_empty()) else {
            return Ok(());
        };
        let id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM jobs WHERE canonical_key = ?1 AND COALESCE(TRIM(jd_text), '') = ''",
        )
        .bind(&job.canonical_key)
        .fetch_optional(&self.pool)
        .await?;
        match id {
            Some(id) => {
                self.save_description(&id, text).await?;
            }
            None => {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "UPDATE jobs SET jd_text = ?1, updated_at = ?2 \
                     WHERE canonical_key = ?3 AND {TRUNCATED_DESCRIPTION} AND LENGTH(?1) > LENGTH(jd_text)"
                )))
                .bind(text)
                .bind(now_iso())
                .bind(&job.canonical_key)
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }

    /// Replaces a cut-off copy of the same text. Scores are kept.
    pub async fn extend_description(&self, job_id: &str, text: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE jobs SET jd_text = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(text)
            .bind(now_iso())
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Stores a description. A job still waiting in triage goes back to scoring,
    /// since its old score did not see this text. Any other job that was scored
    /// without a description is only marked. Returns false for an unknown job.
    pub async fn save_description(&self, job_id: &str, text: &str) -> Result<bool, AppError> {
        const REQUEUE: &str =
            "(triage_status = 'pending_triage' AND id NOT IN (SELECT job_id FROM applications))";
        let sql = format!(
            r#"
            UPDATE jobs SET
                jd_text = ?1,
                triage_status = CASE WHEN {REQUEUE} THEN 'pending_scoring' ELSE triage_status END,
                tier1_score = CASE WHEN {REQUEUE} THEN NULL ELSE tier1_score END,
                tier1_json = CASE
                    WHEN {REQUEUE} THEN NULL
                    WHEN COALESCE(TRIM(jd_text), '') = '' AND json_valid(tier1_json)
                        THEN json_set(tier1_json, '$.scored_without_description', json('true'))
                    ELSE tier1_json
                END,
                updated_at = ?2
            WHERE id = ?3
            "#
        );
        let res = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(text)
            .bind(now_iso())
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    pub async fn score_pending_batch(&self, limit: i64) -> Result<ScoreBatchOutcome, AppError> {
        #[derive(sqlx::FromRow)]
        struct PendingJobRow {
            id: String,
            company: String,
            title: String,
            location: Option<String>,
            workplace_type: Option<String>,
            jd_text: Option<String>,
        }

        if !self.ai.is_enabled() {
            return Err(AppError::ServiceUnavailable(
                AI_DISABLED_MESSAGE.to_string(),
            ));
        }
        let clamped_limit = limit.clamp(1, 25);
        let rows = sqlx::query_as::<_, PendingJobRow>(
            r#"
            SELECT id, company, title, location, workplace_type, jd_text
            FROM jobs
            WHERE triage_status = 'pending_scoring'
            ORDER BY created_at ASC
            LIMIT ?1
            "#,
        )
        .bind(clamped_limit)
        .fetch_all(&self.pool)
        .await?;

        if rows.is_empty() {
            return Ok(ScoreBatchOutcome {
                scored: 0,
                items: Vec::new(),
                provider: self.ai.name().to_string(),
                model: "none".to_string(),
            });
        }

        let inputs: Vec<TriageJobInput> = rows
            .into_iter()
            .map(|r| TriageJobInput {
                id: r.id,
                company: r.company,
                title: r.title,
                location: r.location,
                workplace_type: r.workplace_type,
                jd_snippet: r.jd_text.unwrap_or_default(),
            })
            .collect();

        let profile = crate::profile::load_profile(&self.config.data_dir);
        let weights = profile.scoring_weights();
        let doc_digests = self.load_project_doc_digests().await;
        let compiled_digest = profile.build_triage_digest(&doc_digests);
        let profile_summary = compiled_digest
            .as_deref()
            .or(self.config.profile_summary.as_deref())
            .unwrap_or("Senior systems/backend engineer evaluating role fit.");
        let (system_prompt, prompt) = build_triage_batch_prompt(profile_summary, &weights, &inputs);

        let routing = self.ai_routing().await;
        let started = Instant::now();
        let req = AiRequest {
            tier: AiTier::Fast,
            system_prompt: Some(system_prompt),
            prompt,
            max_tokens: Some(2000),
            temperature: Some(0.1),
            json_mode: true,
            timeout_secs: Some(90),
            routing_mode: Some(routing.mode),
            primary: None,
            allow_failover: true,
        };

        let resp = match self.ai.complete(req).await {
            Ok(r) => r,
            Err(err) => {
                let msg = err.to_string();
                let _ = self
                    .record_ai_usage(AiUsageRecord::failure(
                        AiTier::Fast,
                        self.ai.name(),
                        started.elapsed().as_millis() as i64,
                        &msg,
                        None,
                    ))
                    .await;
                return Err(err);
            }
        };

        let _ = self
            .record_ai_usage(AiUsageRecord::success(AiTier::Fast, &resp, None))
            .await;

        let items = parse_triage_batch_response(&resp.content)?;
        let now = now_iso();
        let mut updated_count = 0usize;

        for item in &items {
            let next_status = if item.recommended_status == "skipped" {
                "skipped"
            } else {
                "pending_triage"
            };
            let tier1_json =
                serde_json::to_string(item).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

            let res = sqlx::query(
                r#"
                UPDATE jobs
                SET tier1_score = ?1,
                    tier1_json = ?2,
                    triage_status = ?3,
                    updated_at = ?4
                WHERE id = ?5 AND triage_status = 'pending_scoring'
                "#,
            )
            .bind(item.score)
            .bind(tier1_json)
            .bind(next_status)
            .bind(&now)
            .bind(&item.job_id)
            .execute(&self.pool)
            .await?;

            if res.rows_affected() > 0 {
                updated_count += 1;
            }
        }

        Ok(ScoreBatchOutcome {
            scored: updated_count,
            items,
            provider: resp.provider,
            model: resp.model,
        })
    }

    pub async fn record_ai_usage(&self, rec: AiUsageRecord<'_>) -> Result<(), AppError> {
        sqlx::query(
            r#"
            INSERT INTO ai_usage_events (
                id, tier, provider, model, prompt_tokens, completion_tokens, cost_usd,
                latency_ms, success, error_message, job_id, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
        )
        .bind(new_id())
        .bind(rec.tier.as_str())
        .bind(rec.provider)
        .bind(rec.model)
        .bind(rec.prompt_tokens)
        .bind(rec.completion_tokens)
        .bind(rec.cost_usd)
        .bind(rec.latency_ms)
        .bind(if rec.success { 1_i64 } else { 0_i64 })
        .bind(rec.error_message)
        .bind(rec.job_id)
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Routing from Settings. A missing or unreadable value falls back to defaults: a bad
    /// settings row must never make AI routes fail.
    pub async fn ai_routing(&self) -> AiRouting {
        let raw: Option<String> =
            match sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?1")
                .bind(AI_ROUTING_KEY)
                .fetch_optional(&self.pool)
                .await
            {
                Ok(v) => v,
                Err(err) => {
                    tracing::warn!(error = %err, "cannot read ai_routing; using defaults");
                    None
                }
            };
        match raw {
            None => AiRouting::default(),
            Some(raw) => AiRouting::from_stored_json(&raw).unwrap_or_else(|err| {
                tracing::warn!(error = %err, "invalid ai_routing setting; using defaults");
                AiRouting::default()
            }),
        }
    }

    /// A valid Google access token, refreshing it if needed; `None` when Google
    /// isn't connected (or no encryption key is configured).
    pub async fn google_access_token(&self) -> Result<Option<String>, AppError> {
        let Some(cipher) = &self.cipher else {
            return Ok(None);
        };
        let oauth = self.build_google_oauth_client();
        get_valid_google_access_token(&self.pool, cipher, oauth.as_ref()).await
    }

    /// Like [`Self::google_access_token`] but 409 `GOOGLE_NOT_CONNECTED` when absent.
    pub async fn require_google_access_token(&self) -> Result<String, AppError> {
        self.google_access_token().await?.ok_or_else(|| {
            AppError::ConflictCode(
                "GOOGLE_NOT_CONNECTED",
                "Google is not connected; connect it in Settings first".into(),
            )
        })
    }

    pub async fn sync_google_workspace(&self) -> Result<(i64, i64), AppError> {
        let Some(access_token) = self.google_access_token().await? else {
            return Ok((0, 0));
        };

        let threads = self
            .gmail
            .list_and_fetch_threads(
                &access_token,
                "label:inbox (interview OR application OR recruiter)",
                20,
            )
            .await?;

        let now = now_iso();
        let mut gmail_count = 0_i64;
        for thr in &threads {
            let labels_json = serde_json::to_string(&thr.labels)
                .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
            sqlx::query(
                r#"
                INSERT INTO gmail_threads (
                    id, thread_id, subject, from_email, labels_json, snippet,
                    needs_reply, last_message_at, synced_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(thread_id) DO UPDATE SET
                    subject = excluded.subject,
                    from_email = excluded.from_email,
                    labels_json = excluded.labels_json,
                    snippet = excluded.snippet,
                    needs_reply = excluded.needs_reply,
                    last_message_at = excluded.last_message_at,
                    synced_at = excluded.synced_at
                "#,
            )
            .bind(new_id())
            .bind(&thr.thread_id)
            .bind(&thr.subject)
            .bind(&thr.from_email)
            .bind(labels_json)
            .bind(&thr.snippet)
            .bind(if thr.needs_reply { 1_i64 } else { 0_i64 })
            .bind(&thr.last_message_at)
            .bind(&now)
            .execute(&self.pool)
            .await?;
            gmail_count += 1;
        }

        let time_min = now_iso();
        let events = self
            .calendar
            .list_upcoming_events(&access_token, &time_min, CALENDAR_PAGE as u32)
            .await?;

        const CALENDAR_PAGE: usize = 20;
        let mut cal_count = 0_i64;
        let mut last_start: Option<String> = None;
        for evt in &events {
            let starts_at = crate::sync::calendar::normalize_event_time(
                &evt.start
                    .date_time
                    .clone()
                    .or_else(|| evt.start.date.clone())
                    .unwrap_or_else(|| now.clone()),
            );
            let ends_at = crate::sync::calendar::normalize_event_time(
                &evt.end
                    .date_time
                    .clone()
                    .or_else(|| evt.end.date.clone())
                    .unwrap_or_else(|| starts_at.clone()),
            );
            last_start = Some(starts_at.clone());
            let title = evt
                .summary
                .clone()
                .unwrap_or_else(|| "Calendar Event".to_string());
            let kind = if title.to_ascii_lowercase().contains("prep") {
                "prep"
            } else if title.to_ascii_lowercase().contains("follow") {
                "followup"
            } else {
                "interview"
            };

            sqlx::query(
                r#"
                INSERT INTO calendar_events (
                    id, gcal_event_id, kind, title, starts_at, ends_at, html_link, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(gcal_event_id) DO UPDATE SET
                    title = excluded.title,
                    starts_at = excluded.starts_at,
                    ends_at = excluded.ends_at,
                    html_link = excluded.html_link
                "#,
            )
            .bind(new_id())
            .bind(&evt.id)
            .bind(kind)
            .bind(title)
            .bind(starts_at)
            .bind(ends_at)
            .bind(&evt.html_link)
            .bind(&now)
            .execute(&self.pool)
            .await?;
            cal_count += 1;
        }

        // Events deleted/cancelled in Google drop out of the list; remove them
        // from the window Google actually returned (all upcoming if the page
        // wasn't full, otherwise up to the last returned start).
        let kept: Vec<String> = events.iter().map(|e| e.id.clone()).collect();
        let window_end = (events.len() >= CALENDAR_PAGE)
            .then_some(last_start)
            .flatten();
        crate::sync::calendar::prune_missing_events(
            &self.pool,
            &kept,
            &time_min,
            window_end.as_deref(),
        )
        .await?;

        crate::sync::link::relink_all(&self.pool).await?;

        if self
            .config
            .google_drive_projects_folder_id
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
        {
            if let Err(err) = self.sync_project_docs(&access_token).await {
                tracing::warn!(
                    error = %err,
                    "project docs sync failed during google workspace sync"
                );
            }
        }

        Ok((gmail_count, cal_count))
    }

    /// Syncs Google Docs inside `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` into SQLite `project_docs`
    /// and runs a compact fast digest pass for any new or modified Doc.
    pub async fn sync_project_docs(
        &self,
        access_token: &str,
    ) -> Result<ProjectDocsSyncOutcome, AppError> {
        let Some(folder_id) = self
            .config
            .google_drive_projects_folder_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            return Ok(ProjectDocsSyncOutcome::default());
        };

        let files = self
            .drive
            .list_files_in_folder(access_token, folder_id)
            .await?;

        let mut outcome = ProjectDocsSyncOutcome::default();
        let routing = self.ai_routing().await;

        for file in files {
            if file.mime_type.as_deref() != Some("application/vnd.google-apps.document") {
                continue;
            }

            let existing: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                "SELECT modified_time, digest_json FROM project_docs WHERE drive_file_id = ?1",
            )
            .bind(&file.id)
            .fetch_optional(&self.pool)
            .await?;

            let now = now_iso();
            if let Some((prev_mod, prev_digest)) = &existing {
                if *prev_mod == file.modified_time && prev_digest.is_some() {
                    sqlx::query(
                        "UPDATE project_docs SET title = ?1, drive_url = ?2, synced_at = ?3 WHERE drive_file_id = ?4",
                    )
                    .bind(&file.name)
                    .bind(&file.web_view_link)
                    .bind(&now)
                    .bind(&file.id)
                    .execute(&self.pool)
                    .await?;
                    outcome.skipped_unchanged += 1;
                    continue;
                }
            }

            let raw_markdown = self
                .drive
                .export_doc_markdown(access_token, &file.id)
                .await?;
            let modified_changed = existing
                .as_ref()
                .is_some_and(|(prev_mod, _)| *prev_mod != file.modified_time);

            sqlx::query(
                r#"
                INSERT INTO project_docs (
                    id, drive_file_id, title, drive_url, modified_time, raw_markdown, synced_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(drive_file_id) DO UPDATE SET
                    title = excluded.title,
                    drive_url = excluded.drive_url,
                    modified_time = excluded.modified_time,
                    raw_markdown = excluded.raw_markdown,
                    digest_json = CASE WHEN ?8 THEN NULL ELSE project_docs.digest_json END,
                    digested_at = CASE WHEN ?8 THEN NULL ELSE project_docs.digested_at END,
                    synced_at = excluded.synced_at
                "#,
            )
            .bind(new_id())
            .bind(&file.id)
            .bind(&file.name)
            .bind(&file.web_view_link)
            .bind(&file.modified_time)
            .bind(&raw_markdown)
            .bind(&now)
            .bind(modified_changed)
            .execute(&self.pool)
            .await?;
            outcome.docs_synced += 1;

            let needs_digest = existing.is_none()
                || modified_changed
                || existing.is_some_and(|(_, d)| d.is_none());
            if needs_digest && self.ai.is_enabled() && !raw_markdown.trim().is_empty() {
                let (sys, usr) = build_project_doc_digest_prompt(&file.name, &raw_markdown);
                let started = Instant::now();
                let req = AiRequest {
                    tier: AiTier::Fast,
                    system_prompt: Some(sys),
                    prompt: usr,
                    max_tokens: Some(1000),
                    temperature: Some(0.1),
                    json_mode: true,
                    timeout_secs: Some(60),
                    routing_mode: Some(routing.mode),
                    primary: None,
                    allow_failover: true,
                };
                match self.ai.complete(req).await {
                    Ok(resp) => {
                        let _ = self
                            .record_ai_usage(AiUsageRecord::success(AiTier::Fast, &resp, None))
                            .await;
                        match parse_project_doc_digest_response(&resp.content) {
                            Ok(digest) => {
                                if let Ok(digest_json) = serde_json::to_string(&digest) {
                                    sqlx::query(
                                        "UPDATE project_docs SET digest_json = ?1, digested_at = ?2 WHERE drive_file_id = ?3",
                                    )
                                    .bind(digest_json)
                                    .bind(now_iso())
                                    .bind(&file.id)
                                    .execute(&self.pool)
                                    .await?;
                                    outcome.docs_digested += 1;
                                }
                            }
                            Err(err) => {
                                tracing::warn!(title = %file.name, error = %err, "invalid project doc digest JSON");
                            }
                        }
                    }
                    Err(err) => {
                        let msg = err.to_string();
                        let _ = self
                            .record_ai_usage(AiUsageRecord::failure(
                                AiTier::Fast,
                                self.ai.name(),
                                started.elapsed().as_millis() as i64,
                                &msg,
                                None,
                            ))
                            .await;
                        tracing::warn!(title = %file.name, error = %msg, "failed to digest project doc");
                    }
                }
            }
        }

        Ok(outcome)
    }

    pub async fn load_project_doc_digests(&self) -> Vec<String> {
        let rows: Vec<(String, String)> = match sqlx::query_as(
            "SELECT title, digest_json FROM project_docs WHERE digest_json IS NOT NULL ORDER BY title ASC",
        )
        .fetch_all(&self.pool)
        .await
        {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(error = %err, "failed loading project doc digests");
                return Vec::new();
            }
        };

        rows.into_iter()
            .filter_map(|(title, raw)| {
                let d: ProjectDocDigest = serde_json::from_str(&raw).ok()?;
                let mut parts = vec![format!("{}: {}", title, d.summary)];
                if !d.stack.is_empty() {
                    parts.push(format!("Stack: {}", d.stack.join(", ")));
                }
                if !d.verified_claims.is_empty() {
                    parts.push(format!("Claims: {}", d.verified_claims.join("; ")));
                }
                Some(parts.join(" | "))
            })
            .collect()
    }

    pub async fn load_project_docs_raw(&self) -> Vec<(String, String)> {
        match sqlx::query_as(
            "SELECT title, raw_markdown FROM project_docs WHERE length(trim(raw_markdown)) > 0 ORDER BY title ASC",
        )
        .fetch_all(&self.pool)
        .await
        {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(error = %err, "failed loading raw project docs");
                Vec::new()
            }
        }
    }
}
