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
        build_neon_evaluation_prompt, parse_neon_evaluation_response, AiRequest, AiTier,
        AiUsageReport, HydrogenScoreItem, NeonEvaluationResult, NeonJobInput,
    },
    db::{new_id, now_iso},
    error::AppError,
    routes::jobs::JobRecord,
    state::AppState,
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
    pub items: Vec<HydrogenScoreItem>,
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
    pub result: NeonEvaluationResult,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct AiUsageTierStat {
    pub tier: String,
    pub total_calls: i64,
    pub successful_calls: i64,
    pub avg_latency_ms: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AiUsageSummaryResponse {
    pub bridge: AiUsageReport,
    pub db_stats_by_tier: Vec<AiUsageTierStat>,
}

#[utoipa::path(
    post,
    path = "/api/ai/score-pending",
    request_body = ScorePendingRequest,
    responses(
        (status = 200, description = "Run batched hydrogen tier-1 scoring", body = ScorePendingResponse)
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

    let tier = req.tier.unwrap_or(AiTier::Neon);
    let profile_summary = state
        .config
        .profile_summary
        .as_deref()
        .unwrap_or("Senior systems/backend engineer evaluating role fit.");
    let (system_prompt, prompt) = build_neon_evaluation_prompt(
        profile_summary,
        &NeonJobInput {
            id: job.id.clone(),
            company: job.company.clone(),
            title: job.title.clone(),
            location: job.location.clone(),
            url: job.url.clone(),
            jd_text: job.jd_text.unwrap_or_default(),
        },
    );

    let started = Instant::now();
    let ai_req = AiRequest {
        tier,
        system_prompt: Some(system_prompt),
        prompt,
        max_tokens: Some(4000),
        temperature: Some(0.2),
        json_mode: true,
        timeout_secs: Some(120),
    };

    let resp = match state.ai.complete(ai_req).await {
        Ok(r) => r,
        Err(err) => {
            let _ = state
                .record_ai_usage(
                    tier,
                    state.ai.name(),
                    "unknown",
                    None,
                    None,
                    started.elapsed().as_millis() as i64,
                    false,
                    Some(&err.to_string()),
                    Some(&job_id),
                )
                .await;
            return Err(err);
        }
    };

    let _ = state
        .record_ai_usage(
            tier,
            &resp.provider,
            &resp.model,
            resp.prompt_tokens.map(i64::from),
            resp.completion_tokens.map(i64::from),
            resp.latency_ms as i64,
            true,
            None,
            Some(&job_id),
        )
        .await;

    let result = parse_neon_evaluation_response(&resp.content)?;
    let evaluation_id = new_id();
    let blocks_json = serde_json::to_string(&result.blocks)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    sqlx::query(
        r#"
        INSERT INTO evaluations (
            id, job_id, tier, model, overall_score, archetype, blocks_json, report_md, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
    )
    .bind(&evaluation_id)
    .bind(&job_id)
    .bind(tier.as_str())
    .bind(&resp.model)
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
        (status = 200, description = "AI bridge status and recorded usage stats", body = AiUsageSummaryResponse)
    ),
    tag = "ai"
)]
pub async fn get_ai_usage(
    State(state): State<AppState>,
) -> Result<Json<AiUsageSummaryResponse>, AppError> {
    let bridge = state.ai.usage().await?;
    let db_stats_by_tier = sqlx::query_as::<_, AiUsageTierStat>(
        r#"
        SELECT tier,
               COUNT(*) AS total_calls,
               SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful_calls,
               AVG(CAST(latency_ms AS REAL)) AS avg_latency_ms
        FROM ai_usage_events
        GROUP BY tier
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(AiUsageSummaryResponse {
        bridge,
        db_stats_by_tier,
    }))
}
