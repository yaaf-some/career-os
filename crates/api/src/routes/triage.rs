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
pub struct TriageBatchFailure {
    pub job_id: String,
    pub error: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TriageBatchResponse {
    pub updated: usize,
    pub results: Vec<TriageResponse>,
    /// Jobs that were not updated, each with the reason.
    pub failed: Vec<TriageBatchFailure>,
}

/// Marks an application that a Save created, so that only those can be removed
/// when the Save is undone.
const TRIAGE_APPLICATION_PREFIX: &str = "triage-";

/// Removes the pipeline entry a Save created, unless anything has happened to it
/// since: a later stage (now or ever), dates, notes, links or linked records.
/// One statement, so nothing can be added between the check and the delete.
const REMOVE_UNTOUCHED_TRIAGE_APPLICATION: &str = r#"
    DELETE FROM applications
    WHERE job_id = ?1
      AND id LIKE ?2
      AND stage = 'shortlisted'
      AND applied_at IS NULL
      AND next_followup_at IS NULL
      AND followup_count = 0
      AND COALESCE(notes, '') = ''
      AND gmail_thread_id IS NULL
      AND linear_issue_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM gmail_threads WHERE application_id = applications.id)
      AND NOT EXISTS (SELECT 1 FROM calendar_events WHERE application_id = applications.id)
      AND NOT EXISTS (SELECT 1 FROM email_drafts WHERE application_id = applications.id)
      AND NOT EXISTS (
          SELECT 1 FROM job_events
          WHERE job_events.job_id = applications.job_id
            AND job_events.kind = 'stage'
            AND job_events.to_value <> 'shortlisted'
      )
"#;

async fn apply_triage_action(
    state: &AppState,
    job_id: &str,
    action: TriageAction,
) -> Result<TriageResponse, AppError> {
    let now = now_iso();

    let previous: Option<String> =
        sqlx::query_scalar("SELECT triage_status FROM jobs WHERE id = ?1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?;

    // A restored job that was never scored goes back to the scoring queue.
    let new_status: String = sqlx::query_scalar(
        r#"
        UPDATE jobs SET
            triage_status = CASE
                WHEN ?1 = 'pending_triage' AND tier1_score IS NULL AND tier1_json IS NULL
                    THEN 'pending_scoring'
                ELSE ?1
            END,
            updated_at = ?2
        WHERE id = ?3
        RETURNING triage_status
        "#,
    )
    .bind(action.target_status())
    .bind(&now)
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if previous.as_deref() != Some(new_status.as_str()) {
        state
            .record_job_event(job_id, "triage", previous.as_deref(), &new_status)
            .await?;
    }

    match action {
        TriageAction::Shortlist => {
            sqlx::query(
                r#"
                INSERT INTO applications (id, job_id, stage, updated_at)
                VALUES (?1, ?2, 'shortlisted', ?3)
                ON CONFLICT(job_id) DO UPDATE SET updated_at = excluded.updated_at
                "#,
            )
            .bind(format!("{TRIAGE_APPLICATION_PREFIX}{}", new_id()))
            .bind(job_id)
            .bind(&now)
            .execute(&state.pool)
            .await?;
        }
        TriageAction::Restore => {
            sqlx::query(REMOVE_UNTOUCHED_TRIAGE_APPLICATION)
                .bind(job_id)
                .bind(format!("{TRIAGE_APPLICATION_PREFIX}%"))
                .execute(&state.pool)
                .await?;
        }
        TriageAction::Skip | TriageAction::Blacklist => {}
    }

    // For `restore` this is the pipeline entry that was kept, if any.
    let application_id = if matches!(action, TriageAction::Shortlist | TriageAction::Restore) {
        sqlx::query_scalar::<_, String>("SELECT id FROM applications WHERE job_id = ?1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
    } else {
        None
    };

    Ok(TriageResponse {
        job_id: job_id.to_string(),
        triage_status: new_status,
        application_id,
    })
}

/// What a batch caller may be told about one failed job.
fn batch_failure(job_id: &str, err: AppError) -> TriageBatchFailure {
    let error = match &err {
        AppError::NotFound(message) => message.clone(),
        other => {
            tracing::warn!(error = %other, job_id, "batch triage item failed");
            "could not update this job".to_string()
        }
    };
    TriageBatchFailure {
        job_id: job_id.to_string(),
        error,
    }
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
    let mut failed = Vec::new();
    for job_id in &req.job_ids {
        match apply_triage_action(&state, job_id, req.action).await {
            Ok(item) => results.push(item),
            Err(err) => failed.push(batch_failure(job_id, err)),
        }
    }
    Ok(Json(TriageBatchResponse {
        updated: results.len(),
        results,
        failed,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::{ai::MockAiProvider, config::AppConfig, db::init_pool};

    async fn state_with_jobs() -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, tier1_score) VALUES
               ('scored','k1','https://jobs.example.com/1','Example Co','Platform Engineer','manual','pending_triage',80),
               ('unscored','k2','https://jobs.example.com/2','Example Co','Data Engineer','manual','pending_scoring',NULL)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        AppState::for_test(pool, AppConfig::default(), Arc::new(MockAiProvider))
    }

    async fn act(state: &AppState, id: &str, action: TriageAction) -> TriageResponse {
        apply_triage_action(state, id, action).await.unwrap()
    }

    async fn run(state: &AppState, sql: &'static str) {
        sqlx::query(sql).execute(&state.pool).await.unwrap();
    }

    async fn applications(state: &AppState) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM applications")
            .fetch_one(&state.pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn undoing_a_save_leaves_no_pipeline_entry() {
        let state = state_with_jobs().await;
        let saved = act(&state, "scored", TriageAction::Shortlist).await;
        assert!(saved.application_id.is_some());

        let restored = act(&state, "scored", TriageAction::Restore).await;
        assert_eq!(restored.triage_status, "pending_triage");
        assert_eq!(restored.application_id, None);
        assert_eq!(applications(&state).await, 0);
    }

    #[tokio::test]
    async fn restore_cleans_up_a_save_that_was_repeated_then_skipped() {
        let state = state_with_jobs().await;
        act(&state, "scored", TriageAction::Shortlist).await;
        act(&state, "scored", TriageAction::Shortlist).await;
        act(&state, "scored", TriageAction::Skip).await;
        act(&state, "scored", TriageAction::Restore).await;
        assert_eq!(applications(&state).await, 0);
    }

    #[tokio::test]
    async fn restore_sends_a_never_scored_job_back_to_scoring() {
        let state = state_with_jobs().await;
        act(&state, "unscored", TriageAction::Skip).await;
        let restored = act(&state, "unscored", TriageAction::Restore).await;
        assert_eq!(restored.triage_status, "pending_scoring");
    }

    #[tokio::test]
    async fn restore_keeps_a_pipeline_entry_that_existed_before_the_save() {
        let state = state_with_jobs().await;
        run(
            &state,
            "INSERT INTO applications (id, job_id) VALUES ('earlier', 'scored')",
        )
        .await;
        act(&state, "scored", TriageAction::Shortlist).await;
        let restored = act(&state, "scored", TriageAction::Restore).await;
        assert_eq!(restored.application_id.as_deref(), Some("earlier"));
        assert_eq!(applications(&state).await, 1);
    }

    #[tokio::test]
    async fn restore_keeps_a_pipeline_entry_with_any_progress() {
        for progress in [
            "UPDATE applications SET stage = 'applied'",
            "UPDATE applications SET applied_at = '2026-11-01T00:00:00Z'",
            "UPDATE applications SET next_followup_at = '2026-11-01T00:00:00Z'",
            "UPDATE applications SET followup_count = 1",
            "UPDATE applications SET notes = 'Talked to a recruiter'",
            "UPDATE applications SET linear_issue_id = 'EX-1'",
            "UPDATE applications SET gmail_thread_id = 'thread'",
            "INSERT INTO gmail_threads (id, thread_id, application_id) \
             SELECT 't1', 'g1', id FROM applications",
            "INSERT INTO calendar_events (id, gcal_event_id, application_id, kind, title, starts_at, ends_at) \
             SELECT 'e1', 'c1', id, 'prep', 'Prep', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z' \
             FROM applications",
            "INSERT INTO email_drafts (id, application_id) SELECT 'd1', id FROM applications",
            // Moved on and back again: the history still protects it.
            "INSERT INTO job_events (id, job_id, kind, from_value, to_value) \
             VALUES ('v1', 'scored', 'stage', 'shortlisted', 'interviewing')",
        ] {
            let state = state_with_jobs().await;
            act(&state, "scored", TriageAction::Shortlist).await;
            run(&state, progress).await;
            let restored = act(&state, "scored", TriageAction::Restore).await;
            assert!(restored.application_id.is_some(), "{progress}");
            assert_eq!(applications(&state).await, 1, "{progress}");
        }
    }

    #[tokio::test]
    async fn batch_reports_the_jobs_it_could_not_update() {
        let state = state_with_jobs().await;
        let Json(out) = triage_batch(
            State(state),
            Json(TriageBatchRequest {
                job_ids: vec!["scored".into(), "missing".into()],
                action: TriageAction::Skip,
            }),
        )
        .await
        .unwrap();
        assert_eq!(out.updated, 1);
        assert_eq!(out.failed.len(), 1);
        assert_eq!(out.failed[0].job_id, "missing");
        assert_eq!(out.failed[0].error, "job missing not found");
    }
}
