use std::time::Instant;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    ai::{
        build_deep_evaluation_prompt, build_triage_batch_prompt, parse_deep_evaluation_response,
        parse_triage_batch_response, select_eval_tier, AiRequest, AiTier, AiUsageReport,
        DeepEvalJobInput, DeepEvaluationResult, TriageJobInput, TriageScoreItem,
        AI_DISABLED_MESSAGE,
    },
    db::{new_id, now_iso},
    error::AppError,
    routes::jobs::{JobRecord, JOB_COLUMNS},
    state::{AiUsageRecord, AppState},
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScorePendingRequest {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ScorePendingResponse {
    pub scored: usize,
    pub provider: String,
    pub model: String,
    pub items: Vec<TriageScoreItem>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RescoreRequest {
    #[serde(default)]
    pub include_skipped: bool,
    pub score_limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RescoreResponse {
    pub reset_count: u64,
    pub scored: usize,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScoreJobResponse {
    pub job_id: String,
    pub score: f64,
    /// The job's status after scoring.
    pub triage_status: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EvaluateJobRequest {
    pub tier: Option<AiTier>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EvaluateJobResponse {
    pub evaluation_id: String,
    pub job_id: String,
    pub tier: AiTier,
    pub provider: String,
    pub model: String,
    pub result: DeepEvaluationResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageTierStat {
    pub tier: String,
    pub total_calls: i64,
    pub successful_calls: i64,
    pub avg_latency_ms: f64,
}

/// One Claude subscription window for the Usage Bar.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageWindow {
    /// 0–100.
    pub percent_used: Option<f64>,
    /// RFC 3339.
    pub reset_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AntigravityStatus {
    Ready,
    Cooldown,
    Exhausted,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityUsage {
    /// agy calls recorded in the last 24 h.
    pub calls_used: i64,
    /// `AI_AGY_DAILY_CALL_LIMIT`, if set.
    pub calls_limit: Option<i64>,
    /// RFC 3339; set while the bridge has agy on rate-limit cooldown.
    pub cooldown_until: Option<String>,
    pub status: AntigravityStatus,
}

/// `GET /api/ai/usage` (shape shared with `web/src/api/types.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageResponse {
    /// False when no bridge is configured (or demo mode).
    pub configured: bool,
    pub bridge_reachable: bool,
    /// When Claude Code last wrote its statusline (RFC 3339).
    pub updated_at: Option<String>,
    pub claude5h: Option<ClaudeUsageWindow>,
    pub claude7d: Option<ClaudeUsageWindow>,
    /// True when there is no fresh Claude usage data.
    pub claude_stale: bool,
    pub antigravity: AntigravityUsage,
    pub db_stats_by_tier: Vec<AiUsageTierStat>,
}

fn unix_to_rfc3339(secs: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
        .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Pure: provider report + DB numbers → response.
pub fn build_usage_response(
    report: &AiUsageReport,
    agy_calls_24h: i64,
    agy_daily_limit: Option<i64>,
    db_stats_by_tier: Vec<AiUsageTierStat>,
    now: chrono::DateTime<chrono::Utc>,
) -> AiUsageResponse {
    let window = |w: &Option<crate::ai::BridgeRateWindow>| {
        w.as_ref().map(|w| ClaudeUsageWindow {
            percent_used: w.used_percentage,
            reset_at: w.resets_at.and_then(unix_to_rfc3339),
        })
    };
    let claude = report.claude.as_ref();
    let cooldown_until = report
        .agy_cooldown_remaining_secs
        .filter(|s| *s > 0)
        .map(|s| {
            (now + chrono::Duration::seconds(s as i64))
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        });
    let status = if cooldown_until.is_some() {
        AntigravityStatus::Cooldown
    } else if agy_daily_limit.is_some_and(|l| agy_calls_24h >= l) {
        AntigravityStatus::Exhausted
    } else {
        AntigravityStatus::Ready
    };
    AiUsageResponse {
        configured: report.configured,
        bridge_reachable: report.bridge_reachable,
        updated_at: claude
            .and_then(|c| c.statusline_updated_at)
            .and_then(unix_to_rfc3339),
        claude5h: claude.and_then(|c| window(&c.five_hour)),
        claude7d: claude.and_then(|c| window(&c.seven_day)),
        claude_stale: claude.map(|c| c.stale).unwrap_or(true),
        antigravity: AntigravityUsage {
            calls_used: agy_calls_24h,
            calls_limit: agy_daily_limit,
            cooldown_until,
            status,
        },
        db_stats_by_tier,
    }
}

#[utoipa::path(
    post,
    path = "/api/ai/score-pending",
    request_body = ScorePendingRequest,
    responses(
        (status = 200, description = "Run batched fast tier-1 triage scoring", body = ScorePendingResponse)
    ),
    tag = "ai"
)]
pub async fn score_pending_jobs(
    State(state): State<AppState>,
    Json(req): Json<ScorePendingRequest>,
) -> Result<Json<ScorePendingResponse>, AppError> {
    let outcome = state.score_pending_batch(req.limit.unwrap_or(10)).await?;
    Ok(Json(ScorePendingResponse {
        scored: outcome.scored,
        provider: outcome.provider,
        model: outcome.model,
        items: outcome.items,
    }))
}

#[utoipa::path(
    post,
    path = "/api/ai/rescore",
    request_body = RescoreRequest,
    responses(
        (status = 200, description = "Reset unapplied triage scores and optionally run a fresh fast scoring batch", body = RescoreResponse)
    ),
    tag = "ai"
)]
pub async fn rescore_jobs(
    State(state): State<AppState>,
    Json(req): Json<RescoreRequest>,
) -> Result<Json<RescoreResponse>, AppError> {
    let score_limit = req.score_limit.unwrap_or(0);
    if score_limit > 0 && !state.ai.is_enabled() {
        return Err(AppError::ServiceUnavailable(
            AI_DISABLED_MESSAGE.to_string(),
        ));
    }

    let now = now_iso();
    let sql = if req.include_skipped {
        r#"
        UPDATE jobs
        SET triage_status = 'pending_scoring',
            tier1_score = NULL,
            tier1_json = NULL,
            updated_at = ?1
        WHERE triage_status IN ('pending_triage', 'skipped')
          AND id NOT IN (SELECT job_id FROM applications)
          AND archived_at IS NULL
        "#
    } else {
        r#"
        UPDATE jobs
        SET triage_status = 'pending_scoring',
            tier1_score = NULL,
            tier1_json = NULL,
            updated_at = ?1
        WHERE triage_status = 'pending_triage'
          AND id NOT IN (SELECT job_id FROM applications)
          AND archived_at IS NULL
        "#
    };

    let res = sqlx::query(sql).bind(&now).execute(&state.pool).await?;
    let reset_count = res.rows_affected();

    if score_limit > 0 {
        let outcome = state.score_pending_batch(score_limit).await?;
        Ok(Json(RescoreResponse {
            reset_count,
            scored: outcome.scored,
            provider: Some(outcome.provider),
            model: Some(outcome.model),
        }))
    } else {
        Ok(Json(RescoreResponse {
            reset_count,
            scored: 0,
            provider: None,
            model: None,
        }))
    }
}

#[utoipa::path(
    post,
    path = "/api/ai/score/{job_id}",
    params(
        ("job_id" = String, Path, description = "Job UUID")
    ),
    responses(
        (status = 200, description = "Redo fast triage scoring for this one job. A job still waiting for review may move to skipped; a saved or skipped job keeps its status.", body = ScoreJobResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "ai"
)]
pub async fn score_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<ScoreJobResponse>, AppError> {
    if !state.ai.is_enabled() {
        return Err(AppError::ServiceUnavailable(
            AI_DISABLED_MESSAGE.to_string(),
        ));
    }
    let job = sqlx::query_as::<_, JobRecord>(sqlx::AssertSqlSafe(format!(
        r#"SELECT {JOB_COLUMNS} FROM jobs WHERE id = ?1"#
    )))
    .bind(&job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    // What the model reads, to notice an edit made while it is thinking.
    let scored_text = job.jd_text.clone();
    let profile = crate::profile::load_effective_profile(&state.pool, &state.config.data_dir).await;
    let weights = profile.scoring_weights();
    let doc_digests = state.load_project_doc_digests().await;
    let compiled_digest = profile.build_triage_digest(&doc_digests);
    let profile_summary = compiled_digest
        .as_deref()
        .or(state.config.profile_summary.as_deref())
        .unwrap_or("Senior systems/backend engineer evaluating role fit.");
    let (system_prompt, prompt) = build_triage_batch_prompt(
        profile_summary,
        &weights,
        &[TriageJobInput {
            id: job.id,
            company: job.company,
            title: job.title,
            location: job.location,
            workplace_type: job.workplace_type,
            jd_snippet: job.jd_text.unwrap_or_default(),
        }],
    );

    let routing = state.ai_routing().await;
    let started = Instant::now();
    let ai_req = AiRequest {
        tier: AiTier::Fast,
        system_prompt: Some(system_prompt),
        prompt,
        max_tokens: Some(2000),
        temperature: Some(0.1),
        json_mode: true,
        timeout_secs: Some(150),
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
                    AiTier::Fast,
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
        .record_ai_usage(AiUsageRecord::success(AiTier::Fast, &resp, Some(&job_id)))
        .await;

    let mut item = parse_triage_batch_response(&resp.content)?
        .into_iter()
        .find(|item| item.job_id == job_id)
        .ok_or_else(|| AppError::Upstream("the model returned no score for this job".into()))?;
    item.score = item.score.clamp(0.0, 100.0);
    let next_status = if item.recommended_status == "skipped" {
        "skipped"
    } else {
        "pending_triage"
    };
    let tier1_json =
        serde_json::to_string(&item).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    // The status is decided in SQL so a verdict given while the model was
    // thinking is never overwritten.
    let updated: Option<String> = sqlx::query_scalar(
        r#"
        UPDATE jobs
        SET tier1_score = ?1,
            tier1_json = ?2,
            triage_status = CASE
                WHEN triage_status IN ('pending_scoring', 'pending_triage')
                     AND id NOT IN (SELECT job_id FROM applications)
                THEN ?3
                ELSE triage_status
            END,
            updated_at = ?4
        WHERE id = ?5 AND jd_text IS ?6
        RETURNING triage_status
        "#,
    )
    .bind(item.score)
    .bind(tier1_json)
    .bind(next_status)
    .bind(now_iso())
    .bind(&job_id)
    .bind(scored_text)
    .fetch_optional(&state.pool)
    .await?;
    let Some(triage_status) = updated else {
        return Err(AppError::Conflict(
            "the job was deleted or its description changed while it was being scored; \
             rescore it again"
                .to_string(),
        ));
    };

    Ok(Json(ScoreJobResponse {
        job_id,
        score: item.score,
        triage_status,
        provider: resp.provider,
        model: resp.model,
    }))
}

#[utoipa::path(
    post,
    path = "/api/ai/evaluate/{job_id}",
    params(
        ("job_id" = String, Path, description = "Job UUID")
    ),
    request_body = EvaluateJobRequest,
    responses(
        (status = 200, description = "Run deep job evaluation and persist report", body = EvaluateJobResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "ai"
)]
pub async fn evaluate_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(req): Json<EvaluateJobRequest>,
) -> Result<Json<EvaluateJobResponse>, AppError> {
    if !state.ai.is_enabled() {
        return Err(AppError::ServiceUnavailable(
            AI_DISABLED_MESSAGE.to_string(),
        ));
    }
    let job = sqlx::query_as::<_, JobRecord>(sqlx::AssertSqlSafe(format!(
        r#"SELECT {JOB_COLUMNS} FROM jobs WHERE id = ?1"#
    )))
    .bind(&job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    let tier = select_eval_tier(req.tier, job.tier1_score);
    let profile = crate::profile::load_effective_profile(&state.pool, &state.config.data_dir).await;
    let raw_docs = state.load_project_docs_raw().await;
    let compiled_dossier = profile.build_deep_eval_dossier(&raw_docs, 16_000);
    let profile_summary = compiled_dossier
        .as_deref()
        .or(state.config.profile_summary.as_deref())
        .unwrap_or("Senior systems/backend engineer evaluating role fit.");
    let (system_prompt, prompt) = build_deep_evaluation_prompt(
        profile_summary,
        &DeepEvalJobInput {
            id: job.id.clone(),
            company: job.company.clone(),
            title: job.title.clone(),
            location: job.location.clone(),
            url: job.url.clone(),
            jd_text: job.jd_text.unwrap_or_default(),
        },
    );

    let routing = state.ai_routing().await;
    let started = Instant::now();
    let ai_req = AiRequest {
        tier,
        system_prompt: Some(system_prompt),
        prompt,
        max_tokens: Some(4000),
        temperature: Some(0.2),
        json_mode: true,
        timeout_secs: Some(120),
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

    let result = parse_deep_evaluation_response(&resp.content)?;
    let evaluation_id = new_id();
    let blocks_json = serde_json::to_string(&result.blocks)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    sqlx::query(
        r#"
        INSERT INTO evaluations (
            id, job_id, tier, model, provider, overall_score, archetype, blocks_json,
            report_md, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
    )
    .bind(&evaluation_id)
    .bind(&job_id)
    .bind(tier.as_str())
    .bind(&resp.model)
    .bind(&resp.provider)
    .bind(result.overall_score)
    .bind(&result.archetype)
    .bind(blocks_json)
    .bind(&result.report_md)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    Ok(Json(EvaluateJobResponse {
        evaluation_id,
        job_id,
        tier,
        provider: resp.provider,
        model: resp.model,
        result,
    }))
}

#[utoipa::path(
    get,
    path = "/api/ai/usage",
    responses(
        (status = 200, description = "Claude/agy quota and recorded usage stats", body = AiUsageResponse)
    ),
    tag = "ai"
)]
pub async fn get_ai_usage(
    State(state): State<AppState>,
) -> Result<Json<AiUsageResponse>, AppError> {
    let report = state.ai.usage().await?;
    let db_stats_by_tier = sqlx::query_as::<_, AiUsageTierStat>(
        r#"
        SELECT tier,
               COUNT(*) AS total_calls,
               SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful_calls,
               AVG(CAST(latency_ms AS REAL)) AS avg_latency_ms
        FROM ai_usage_events
        GROUP BY tier
        ORDER BY tier
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let now = chrono::Utc::now();
    let since =
        (now - chrono::Duration::hours(24)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let agy_calls_24h: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ai_usage_events WHERE provider = 'agy' AND created_at >= ?1",
    )
    .bind(since)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(build_usage_response(
        &report,
        agy_calls_24h,
        state.config.ai_agy_daily_call_limit,
        db_stats_by_tier,
        now,
    )))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/api/ai/score-pending",
            axum::routing::post(score_pending_jobs),
        )
        .route("/api/ai/rescore", axum::routing::post(rescore_jobs))
        .route("/api/ai/score/{job_id}", axum::routing::post(score_job))
        .route(
            "/api/ai/evaluate/{job_id}",
            axum::routing::post(evaluate_job),
        )
        .route("/api/ai/usage", axum::routing::get(get_ai_usage))
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(
    score_pending_jobs,
    rescore_jobs,
    score_job,
    evaluate_job,
    get_ai_usage
))]
pub struct Doc;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{BridgeClaudeUsage, BridgeRateWindow};

    fn fixed_now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::from_timestamp(1_790_000_000 - 3_600, 0).unwrap()
    }

    fn sample_report() -> AiUsageReport {
        AiUsageReport {
            configured: true,
            bridge_reachable: true,
            claude: Some(BridgeClaudeUsage {
                five_hour: Some(BridgeRateWindow {
                    used_percentage: Some(23.5),
                    resets_at: Some(1_790_000_000),
                }),
                seven_day: Some(BridgeRateWindow {
                    used_percentage: Some(61.0),
                    resets_at: Some(1_790_400_000),
                }),
                statusline_updated_at: Some(1_789_996_000),
                stale: false,
            }),
            agy_cooldown_remaining_secs: Some(120),
        }
    }

    fn sample_response() -> AiUsageResponse {
        build_usage_response(
            &sample_report(),
            7,
            Some(50),
            vec![
                AiUsageTierStat {
                    tier: "fast".into(),
                    total_calls: 12,
                    successful_calls: 11,
                    avg_latency_ms: 8400.0,
                },
                AiUsageTierStat {
                    tier: "balanced".into(),
                    total_calls: 3,
                    successful_calls: 3,
                    avg_latency_ms: 41000.0,
                },
            ],
            fixed_now(),
        )
    }

    /// The web side tests against the same file (AC8). Regenerate with
    /// `UPDATE_FIXTURES=1 cargo test -p career-os-api ai_usage_fixture`.
    #[test]
    fn ai_usage_fixture_matches_web() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/src/__tests__/fixtures/ai-usage.json");
        let actual = serde_json::to_string_pretty(&sample_response()).unwrap() + "\n";
        if std::env::var("UPDATE_FIXTURES").as_deref() == Ok("1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &actual).unwrap();
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("missing {}: {e}", path.display()));
        assert_eq!(
            actual, expected,
            "fixture out of date; see test doc comment"
        );
    }

    #[test]
    fn usage_response_maps_windows_and_cooldown() {
        let r = sample_response();
        assert_eq!(
            r.claude5h,
            Some(ClaudeUsageWindow {
                percent_used: Some(23.5),
                reset_at: Some("2026-09-21T14:13:20Z".into())
            })
        );
        assert!(!r.claude_stale);
        assert_eq!(r.antigravity.status, AntigravityStatus::Cooldown);
        assert_eq!(
            r.antigravity.cooldown_until.as_deref(),
            Some("2026-09-21T13:15:20Z")
        );
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("claude5h").is_some() && json.get("dbStatsByTier").is_some());
        assert!(json["dbStatsByTier"][0].get("avgLatencyMs").is_some());
    }

    #[test]
    fn usage_response_unconfigured_and_exhausted() {
        let r = build_usage_response(&AiUsageReport::default(), 0, None, vec![], fixed_now());
        assert!(!r.configured && !r.bridge_reachable && r.claude_stale);
        assert_eq!((r.claude5h, r.claude7d, r.updated_at), (None, None, None));
        assert_eq!(r.antigravity.status, AntigravityStatus::Ready);

        let report = AiUsageReport {
            configured: true,
            bridge_reachable: true,
            ..AiUsageReport::default()
        };
        let r = build_usage_response(&report, 50, Some(50), vec![], fixed_now());
        assert_eq!(r.antigravity.status, AntigravityStatus::Exhausted);
    }

    async fn state_with_jobs(jobs: &[(&str, &str)]) -> AppState {
        let state = AppState::for_test(
            crate::db::init_pool("sqlite::memory:").await.unwrap(),
            crate::config::AppConfig::default(),
            std::sync::Arc::new(crate::ai::MockAiProvider),
        );
        for (id, status) in jobs {
            sqlx::query(
                "INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status) \
                 VALUES (?1, ?1, 'https://jobs.example.com/1', 'Example Co', 'Engineer', 'manual', ?2)",
            )
            .bind(id)
            .bind(status)
            .execute(&state.pool)
            .await
            .unwrap();
        }
        state
    }

    #[tokio::test]
    async fn scoring_one_job_leaves_the_others_alone() {
        let state = state_with_jobs(&[
            ("job-a", "pending_scoring"),
            ("job-b", "pending_scoring"),
            ("job-c", "skipped"),
        ])
        .await;
        let score = |id: &str| score_job(State(state.clone()), Path(id.to_string()));

        assert_eq!(
            score("job-a").await.unwrap().0.triage_status,
            "pending_triage"
        );
        // A verdict is the user's: only the score changes.
        assert_eq!(score("job-c").await.unwrap().0.triage_status, "skipped");

        let other: (String, Option<f64>) =
            sqlx::query_as("SELECT triage_status, tier1_score FROM jobs WHERE id = 'job-b'")
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(other, ("pending_scoring".to_string(), None));
        assert!(matches!(score("missing").await, Err(AppError::NotFound(_))));
    }

    /// Replaces the description while "thinking", as a user or a scan might.
    struct EditsWhileThinking(sqlx::SqlitePool);

    impl crate::ai::AiProvider for EditsWhileThinking {
        fn name(&self) -> &'static str {
            "mock"
        }

        fn complete<'a>(
            &'a self,
            req: AiRequest,
        ) -> crate::ai::BoxFuture<'a, Result<crate::ai::AiResponse, AppError>> {
            Box::pin(async move {
                sqlx::query("UPDATE jobs SET jd_text = 'New text'")
                    .execute(&self.0)
                    .await?;
                crate::ai::MockAiProvider.complete(req).await
            })
        }

        fn usage<'a>(&'a self) -> crate::ai::BoxFuture<'a, Result<AiUsageReport, AppError>> {
            crate::ai::MockAiProvider.usage()
        }
    }

    #[tokio::test]
    async fn a_score_for_an_outdated_description_is_dropped() {
        let mut state = state_with_jobs(&[("job-a", "pending_scoring")]).await;
        state.ai = std::sync::Arc::new(EditsWhileThinking(state.pool.clone()));
        let res = score_job(State(state.clone()), Path("job-a".into())).await;
        assert!(matches!(res, Err(AppError::Conflict(_))));
        let job: (String, Option<f64>) =
            sqlx::query_as("SELECT triage_status, tier1_score FROM jobs WHERE id = 'job-a'")
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(job, ("pending_scoring".to_string(), None));
    }

    /// The tier picker offers `fast`, which must still produce a deep report.
    #[tokio::test]
    async fn every_tier_can_evaluate() {
        let state = state_with_jobs(&[("job-a", "pending_triage")]).await;
        for tier in [AiTier::Fast, AiTier::Balanced, AiTier::Deep] {
            let res = evaluate_job(
                State(state.clone()),
                Path("job-a".into()),
                Json(EvaluateJobRequest { tier: Some(tier) }),
            )
            .await
            .unwrap();
            assert_eq!(res.0.tier, tier);
        }
    }
}
