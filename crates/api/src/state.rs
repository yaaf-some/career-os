use std::{sync::Arc, time::Instant};

use sqlx::SqlitePool;

use crate::{
    ai::{
        build_hydrogen_triage_batch_prompt, parse_hydrogen_batch_response, AiProvider, AiRequest,
        AiResponse, AiRouting, AiTier, HydrogenJobInput, HydrogenScoreItem, AI_DISABLED_MESSAGE,
        AI_ROUTING_KEY,
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

#[derive(Debug, Clone)]
pub struct ScoreBatchOutcome {
    pub scored: usize,
    pub items: Vec<HydrogenScoreItem>,
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
            }
        }

        Ok(IngestOutcome {
            ingested,
            duplicates,
        })
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

        let inputs: Vec<HydrogenJobInput> = rows
            .into_iter()
            .map(|r| HydrogenJobInput {
                id: r.id,
                company: r.company,
                title: r.title,
                location: r.location,
                workplace_type: r.workplace_type,
                jd_snippet: r.jd_text.unwrap_or_default(),
            })
            .collect();

        let profile_summary = self
            .config
            .profile_summary
            .as_deref()
            .unwrap_or("Senior systems/backend engineer evaluating role fit.");
        let (system_prompt, prompt) = build_hydrogen_triage_batch_prompt(profile_summary, &inputs);

        let routing = self.ai_routing().await;
        let started = Instant::now();
        let req = AiRequest {
            tier: AiTier::Hydrogen,
            system_prompt: Some(system_prompt),
            prompt,
            max_tokens: Some(2000),
            temperature: Some(0.1),
            json_mode: true,
            timeout_secs: Some(90),
            primary: Some(routing.primary_for(AiTier::Hydrogen)),
            allow_failover: routing.auto_failover,
        };

        let resp = match self.ai.complete(req).await {
            Ok(r) => r,
            Err(err) => {
                let msg = err.to_string();
                let _ = self
                    .record_ai_usage(AiUsageRecord::failure(
                        AiTier::Hydrogen,
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
            .record_ai_usage(AiUsageRecord::success(AiTier::Hydrogen, &resp, None))
            .await;

        let items = parse_hydrogen_batch_response(&resp.content)?;
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
            Some(raw) => serde_json::from_str(&raw).unwrap_or_else(|err| {
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
            .list_upcoming_events(&access_token, &time_min, 20)
            .await?;

        let mut cal_count = 0_i64;
        for evt in &events {
            let starts_at = evt
                .start
                .date_time
                .clone()
                .or_else(|| evt.start.date.clone())
                .unwrap_or_else(|| now.clone());
            let ends_at = evt
                .end
                .date_time
                .clone()
                .or_else(|| evt.end.date.clone())
                .unwrap_or_else(|| starts_at.clone());
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
                    kind = excluded.kind,
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

        crate::sync::link::relink_all(&self.pool).await?;

        Ok((gmail_count, cal_count))
    }
}
