use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TriageAction {
    Shortlist,
    Skip,
    Blacklist,
    Restore,
}

impl TriageAction {
    pub fn target_status(&self) -> &'static str {
        match self {
            Self::Shortlist => "shortlisted",
            Self::Skip => "skipped",
            Self::Blacklist => "blacklisted",
            Self::Restore => "pending_triage",
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TriageRequest {
    pub action: TriageAction,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TriageBatchRequest {
    pub job_ids: Vec<String>,
    pub action: TriageAction,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TriageResponse {
    pub job_id: String,
    pub triage_status: String,
    pub application_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TriageBatchResponse {
    pub updated: usize,
    pub results: Vec<TriageResponse>,
}

async fn apply_triage_action(
    state: &AppState,
    job_id: &str,
    action: TriageAction,
) -> Result<TriageResponse, AppError> {
    let target_status = action.target_status();
    let now = now_iso();

    let previous: Option<String> =
        sqlx::query_scalar("SELECT triage_status FROM jobs WHERE id = ?1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?;

    let res = sqlx::query("UPDATE jobs SET triage_status = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(target_status)
        .bind(&now)
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("job {job_id} not found")));
    }
    if previous.as_deref() != Some(target_status) {
        state
            .record_job_event(job_id, "triage", previous.as_deref(), target_status)
            .await?;
    }

    let application_id = if matches!(action, TriageAction::Shortlist) {
        let app_id = new_id();
        sqlx::query(
            r#"
            INSERT INTO applications (id, job_id, stage, updated_at)
            VALUES (?1, ?2, 'shortlisted', ?3)
            ON CONFLICT(job_id) DO UPDATE SET updated_at = excluded.updated_at
            "#,
        )
        .bind(&app_id)
        .bind(job_id)
        .bind(&now)
        .execute(&state.pool)
        .await?;

        sqlx::query_scalar::<_, String>("SELECT id FROM applications WHERE job_id = ?1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
    } else {
        None
    };

    Ok(TriageResponse {
        job_id: job_id.to_string(),
        triage_status: target_status.to_string(),
        application_id,
    })
}

#[utoipa::path(
    post,
    path = "/api/triage/{id}",
    params(
        ("id" = String, Path, description = "Job UUID")
    ),
    request_body = TriageRequest,
    responses(
        (status = 200, description = "Job triage status updated", body = TriageResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "triage"
)]
pub async fn triage_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<TriageRequest>,
) -> Result<Json<TriageResponse>, AppError> {
    let out = apply_triage_action(&state, &id, req.action).await?;
    Ok(Json(out))
}

#[utoipa::path(
    post,
    path = "/api/triage/batch",
    request_body = TriageBatchRequest,
    responses(
        (status = 200, description = "Batch triage complete", body = TriageBatchResponse),
        (status = 400, description = "Invalid batch", body = crate::error::ErrorResponse)
    ),
    tag = "triage"
)]
pub async fn triage_batch(
    State(state): State<AppState>,
    Json(req): Json<TriageBatchRequest>,
) -> Result<Json<TriageBatchResponse>, AppError> {
    if req.job_ids.len() > 100 {
        return Err(AppError::BadRequest(
            "batch triage limit is 100 job IDs".to_string(),
        ));
    }
    let mut results = Vec::with_capacity(req.job_ids.len());
    for job_id in &req.job_ids {
        if let Ok(item) = apply_triage_action(&state, job_id, req.action).await {
            results.push(item);
        }
    }
    Ok(Json(TriageBatchResponse {
        updated: results.len(),
        results,
    }))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/api/triage/{id}", axum::routing::post(triage_job))
        .route("/api/triage/batch", axum::routing::post(triage_batch))
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(triage_job, triage_batch))]
pub struct Doc;
