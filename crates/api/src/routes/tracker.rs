use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};

use crate::{db::now_iso, error::AppError, state::AppState};

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListApplicationsQuery {
    pub stage: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct ApplicationWithJob {
    pub id: String,
    pub job_id: String,
    pub stage: String,
    pub applied_at: Option<String>,
    pub next_followup_at: Option<String>,
    pub followup_count: i64,
    pub notes: Option<String>,
    pub gmail_thread_id: Option<String>,
    pub linear_issue_id: Option<String>,
    pub updated_at: String,
    pub company: String,
    pub title: String,
    pub url: String,
    pub location: Option<String>,
    pub tier1_score: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListApplicationsResponse {
    pub applications: Vec<ApplicationWithJob>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateApplicationRequest {
    pub stage: Option<String>,
    pub applied_at: Option<String>,
    pub next_followup_at: Option<String>,
    pub followup_count: Option<i64>,
    pub notes: Option<String>,
    pub gmail_thread_id: Option<String>,
    pub linear_issue_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StageCount {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TrackerStatsResponse {
    pub by_triage_status: Vec<StageCount>,
    pub by_application_stage: Vec<StageCount>,
    pub gmail_needs_reply: i64,
    pub pending_followups: i64,
}

const VALID_STAGES: &[&str] = &[
    "shortlisted",
    "applied",
    "recruiter",
    "interviewing",
    "offer",
    "closed",
];

#[utoipa::path(
    get,
    path = "/api/applications",
    params(ListApplicationsQuery),
    responses(
        (status = 200, description = "List tracked applications", body = ListApplicationsResponse)
    ),
    tag = "tracker"
)]
pub async fn list_applications(
    State(state): State<AppState>,
    Query(query): Query<ListApplicationsQuery>,
) -> Result<Json<ListApplicationsResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM applications WHERE (?1 IS NULL OR stage = ?1)",
    )
    .bind(&query.stage)
    .fetch_one(&state.pool)
    .await?;

    let applications = sqlx::query_as::<_, ApplicationWithJob>(
        r#"
        SELECT a.id, a.job_id, a.stage, a.applied_at, a.next_followup_at,
               a.followup_count, a.notes, a.gmail_thread_id, a.linear_issue_id,
               a.updated_at, j.company, j.title, j.url, j.location, j.tier1_score
        FROM applications a
        INNER JOIN jobs j ON j.id = a.job_id
        WHERE (?1 IS NULL OR a.stage = ?1)
        ORDER BY a.updated_at DESC
        LIMIT ?2 OFFSET ?3
        "#,
    )
    .bind(&query.stage)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListApplicationsResponse {
        applications,
        total,
    }))
}

#[utoipa::path(
    patch,
    path = "/api/applications/{id}",
    params(
        ("id" = String, Path, description = "Application UUID")
    ),
    request_body = UpdateApplicationRequest,
    responses(
        (status = 200, description = "Application updated", body = ApplicationWithJob),
        (status = 400, description = "Invalid stage", body = crate::error::ErrorResponse),
        (status = 404, description = "Application not found", body = crate::error::ErrorResponse)
    ),
    tag = "tracker"
)]
pub async fn update_application(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateApplicationRequest>,
) -> Result<Json<ApplicationWithJob>, AppError> {
    if let Some(stage) = &req.stage {
        if !VALID_STAGES.contains(&stage.as_str()) {
            return Err(AppError::BadRequest(format!("invalid stage: {stage}")));
        }
    }

    let now = now_iso();
    let res = sqlx::query(
        r#"
        UPDATE applications
        SET stage = COALESCE(?1, stage),
            applied_at = COALESCE(?2, applied_at),
            next_followup_at = COALESCE(?3, next_followup_at),
            followup_count = COALESCE(?4, followup_count),
            notes = COALESCE(?5, notes),
            gmail_thread_id = COALESCE(?6, gmail_thread_id),
            linear_issue_id = COALESCE(?7, linear_issue_id),
            updated_at = ?8
        WHERE id = ?9
        "#,
    )
    .bind(&req.stage)
    .bind(&req.applied_at)
    .bind(&req.next_followup_at)
    .bind(req.followup_count)
    .bind(&req.notes)
    .bind(&req.gmail_thread_id)
    .bind(&req.linear_issue_id)
    .bind(&now)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("application {id} not found")));
    }

    let updated = sqlx::query_as::<_, ApplicationWithJob>(
        r#"
        SELECT a.id, a.job_id, a.stage, a.applied_at, a.next_followup_at,
               a.followup_count, a.notes, a.gmail_thread_id, a.linear_issue_id,
               a.updated_at, j.company, j.title, j.url, j.location, j.tier1_score
        FROM applications a
        INNER JOIN jobs j ON j.id = a.job_id
        WHERE a.id = ?1
        "#,
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

#[utoipa::path(
    get,
    path = "/api/tracker/stats",
    responses(
        (status = 200, description = "Pipeline and tracker funnel counts", body = TrackerStatsResponse)
    ),
    tag = "tracker"
)]
pub async fn tracker_stats(
    State(state): State<AppState>,
) -> Result<Json<TrackerStatsResponse>, AppError> {
    #[derive(FromRow)]
    struct GroupRow {
        key: String,
        count: i64,
    }

    let triage_rows = sqlx::query_as::<_, GroupRow>(
        "SELECT triage_status AS key, COUNT(*) AS count FROM jobs GROUP BY triage_status",
    )
    .fetch_all(&state.pool)
    .await?;

    let stage_rows = sqlx::query_as::<_, GroupRow>(
        "SELECT stage AS key, COUNT(*) AS count FROM applications GROUP BY stage",
    )
    .fetch_all(&state.pool)
    .await?;

    let gmail_needs_reply =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM gmail_threads WHERE needs_reply = 1")
            .fetch_one(&state.pool)
            .await?;

    let now = now_iso();
    let pending_followups = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM applications WHERE next_followup_at IS NOT NULL AND next_followup_at <= ?1 AND stage != 'closed'",
    )
    .bind(now)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(TrackerStatsResponse {
        by_triage_status: triage_rows
            .into_iter()
            .map(|r| StageCount {
                key: r.key,
                count: r.count,
            })
            .collect(),
        by_application_stage: stage_rows
            .into_iter()
            .map(|r| StageCount {
                key: r.key,
                count: r.count,
            })
            .collect(),
        gmail_needs_reply,
        pending_followups,
    }))
}

// ---- JOB-6: web Tracker view (`GET` / `PATCH /api/tracker`) ----

/// One tracker row: an application with its job and latest linked thread.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerEntry {
    pub application_id: String,
    pub job_id: String,
    pub company: String,
    pub title: String,
    /// DB stage (`shortlisted|applied|recruiter|interviewing|offer|closed`).
    pub stage: String,
    pub hydrogen_score: Option<f64>,
    pub thread_subject: Option<String>,
    pub thread_count: i64,
    pub threads_need_reply: bool,
    pub last_activity_at: String,
    pub next_follow_up_at: Option<String>,
    pub notes: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrackerResponse {
    pub entries: Vec<TrackerEntry>,
}

/// `nextFollowUpAt`: absent = unchanged, `null` = clear, string = set.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrackerRequest {
    pub job_id: String,
    pub stage: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub next_follow_up_at: Option<Option<String>>,
    pub notes: Option<String>,
}

fn double_option<'de, D>(de: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(de).map(Some)
}

pub async fn list_tracker_entries(pool: &sqlx::SqlitePool) -> Result<Vec<TrackerEntry>, AppError> {
    Ok(sqlx::query_as::<_, TrackerEntry>(
        r#"
        SELECT a.id AS application_id, j.id AS job_id, j.company, j.title, a.stage,
               j.tier1_score AS hydrogen_score,
               (SELECT t.subject FROM gmail_threads t WHERE t.application_id = a.id
                ORDER BY t.last_message_at DESC LIMIT 1) AS thread_subject,
               (SELECT COUNT(*) FROM gmail_threads t WHERE t.application_id = a.id) AS thread_count,
               EXISTS (SELECT 1 FROM gmail_threads t
                       WHERE t.application_id = a.id AND t.needs_reply = 1) AS threads_need_reply,
               MAX(a.updated_at, COALESCE((SELECT MAX(t.last_message_at) FROM gmail_threads t
                                           WHERE t.application_id = a.id), '')) AS last_activity_at,
               a.next_followup_at AS next_follow_up_at,
               COALESCE(a.notes, '') AS notes
        FROM applications a JOIN jobs j ON j.id = a.job_id
        ORDER BY last_activity_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?)
}

#[utoipa::path(
    get,
    path = "/api/tracker",
    responses((status = 200, description = "Applications with job and Gmail activity", body = TrackerResponse)),
    tag = "tracker"
)]
pub async fn get_tracker(State(state): State<AppState>) -> Result<Json<TrackerResponse>, AppError> {
    Ok(Json(TrackerResponse {
        entries: list_tracker_entries(&state.pool).await?,
    }))
}

#[utoipa::path(
    patch,
    path = "/api/tracker",
    request_body = UpdateTrackerRequest,
    responses(
        (status = 200, description = "Updated (creates the application if missing); full tracker list", body = TrackerResponse),
        (status = 400, description = "Invalid stage", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "tracker"
)]
pub async fn patch_tracker(
    State(state): State<AppState>,
    Json(req): Json<UpdateTrackerRequest>,
) -> Result<Json<TrackerResponse>, AppError> {
    if let Some(stage) = &req.stage {
        if !VALID_STAGES.contains(&stage.as_str()) {
            return Err(AppError::BadRequest(format!("invalid stage: {stage}")));
        }
    }
    let job: Option<String> = sqlx::query_scalar("SELECT id FROM jobs WHERE id = ?1")
        .bind(&req.job_id)
        .fetch_optional(&state.pool)
        .await?;
    if job.is_none() {
        return Err(AppError::NotFound(format!("job {} not found", req.job_id)));
    }

    let now = now_iso();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO applications (id, job_id, stage, updated_at)
        VALUES (?1, ?2, 'shortlisted', ?3)
        ON CONFLICT(job_id) DO NOTHING
        "#,
    )
    .bind(crate::db::new_id())
    .bind(&req.job_id)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    let (set_follow_up, follow_up) = match &req.next_follow_up_at {
        None => (0_i64, None),
        Some(v) => (1_i64, v.clone()),
    };
    sqlx::query(
        r#"
        UPDATE applications
        SET stage = COALESCE(?1, stage),
            applied_at = CASE WHEN ?1 = 'applied' AND applied_at IS NULL THEN ?5 ELSE applied_at END,
            next_followup_at = CASE WHEN ?2 = 1 THEN ?3 ELSE next_followup_at END,
            notes = COALESCE(?4, notes),
            updated_at = ?5
        WHERE job_id = ?6
        "#,
    )
    .bind(&req.stage)
    .bind(set_follow_up)
    .bind(follow_up)
    .bind(&req.notes)
    .bind(&now)
    .bind(&req.job_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if req.stage.as_deref() == Some("applied") {
        // Best effort: the stage change stands even if Linear is down.
        if let Err(err) = create_linear_issue_once(&state, &req.job_id).await {
            tracing::warn!(error = %err, job_id = %req.job_id, "linear issue creation failed");
        }
    }

    Ok(Json(TrackerResponse {
        entries: list_tracker_entries(&state.pool).await?,
    }))
}

/// Placeholder written while the issue is being created, so a double submit
/// can't create two issues.
const LINEAR_CLAIM: &str = "creating";

/// Creates one Linear issue for the job's application (JOB-6 PR C), only when
/// Linear is configured and the application has none yet. Returns the issue
/// identifier when one was created.
pub async fn create_linear_issue_once(
    state: &AppState,
    job_id: &str,
) -> Result<Option<String>, AppError> {
    let (Some(linear), Some(team_id)) = (&state.linear, &state.config.linear_team_id) else {
        return Ok(None);
    };
    let claimed = sqlx::query(
        "UPDATE applications SET linear_issue_id = ?1 WHERE job_id = ?2 AND linear_issue_id IS NULL",
    )
    .bind(LINEAR_CLAIM)
    .bind(job_id)
    .execute(&state.pool)
    .await?
    .rows_affected();
    if claimed == 0 {
        return Ok(None);
    }

    let (title, company, url): (String, String, String) =
        sqlx::query_as("SELECT title, company, url FROM jobs WHERE id = ?1")
            .bind(job_id)
            .fetch_one(&state.pool)
            .await?;
    let description = format!(
        "Applied to **{title}** at **{company}**.\n\nPosting: {url}\n\n_Created by Career OS when the application was marked applied._"
    );
    match linear
        .create_issue(
            team_id,
            &format!("Applied: {title} @ {company}"),
            &description,
        )
        .await
    {
        Ok(issue) => {
            sqlx::query("UPDATE applications SET linear_issue_id = ?1 WHERE job_id = ?2")
                .bind(&issue.identifier)
                .bind(job_id)
                .execute(&state.pool)
                .await?;
            Ok(Some(issue.identifier))
        }
        Err(err) => {
            sqlx::query(
                "UPDATE applications SET linear_issue_id = NULL WHERE job_id = ?1 AND linear_issue_id = ?2",
            )
            .bind(job_id)
            .bind(LINEAR_CLAIM)
            .execute(&state.pool)
            .await?;
            Err(err)
        }
    }
}

#[cfg(test)]
mod linear_tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use axum::{response::IntoResponse, routing::post, Router};
    use tokio::net::TcpListener;

    use super::*;
    use crate::{
        ai::MockAiProvider,
        config::AppConfig,
        db::init_pool,
        integrations::{
            calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, linear::LinearClient,
            maps::MapsClient, scanner::ScannerClient,
        },
    };

    async fn fake_linear(fail: bool) -> (String, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let app = Router::new().route(
            "/graphql",
            post(move || {
                let c = c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    if fail {
                        return (axum::http::StatusCode::BAD_GATEWAY, "down").into_response();
                    }
                    Json(serde_json::json!({"data": {"issueCreate": {"success": true, "issue": {
                        "id": "uuid-1", "identifier": "JOB-99", "title": "t", "url": "https://linear.example.com/JOB-99"
                    }}}}))
                    .into_response()
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}/graphql"), calls)
    }

    async fn state(linear_url: Option<String>) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        sqlx::query("INSERT INTO jobs (id, canonical_key, url, company, title, source_type) VALUES ('job-1','k1','https://jobs.example.com/1','Example Co','Engineer','manual')")
            .execute(&pool)
            .await
            .unwrap();
        AppState {
            pool,
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                linear_team_id: linear_url.as_ref().map(|_| "team-uuid".to_string()),
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
            linear: linear_url.map(|u| LinearClient::new("test-key".into()).with_url(u)),
        }
    }

    fn patch(stage: &str) -> Json<UpdateTrackerRequest> {
        Json(UpdateTrackerRequest {
            job_id: "job-1".into(),
            stage: Some(stage.into()),
            next_follow_up_at: None,
            notes: None,
        })
    }

    async fn issue_id(st: &AppState) -> Option<String> {
        sqlx::query_scalar("SELECT linear_issue_id FROM applications WHERE job_id = 'job-1'")
            .fetch_one(&st.pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn applied_creates_exactly_one_linear_issue() {
        let (url, calls) = fake_linear(false).await;
        let st = state(Some(url)).await;
        let _ = patch_tracker(State(st.clone()), patch("recruiter"))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let _ = patch_tracker(State(st.clone()), patch("applied"))
            .await
            .unwrap();
        let _ = patch_tracker(State(st.clone()), patch("applied"))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(issue_id(&st).await.as_deref(), Some("JOB-99"));
    }

    #[tokio::test]
    async fn linear_failure_keeps_stage_and_allows_retry() {
        let (url, calls) = fake_linear(true).await;
        let st = state(Some(url)).await;
        let res = patch_tracker(State(st.clone()), patch("applied"))
            .await
            .unwrap();
        assert_eq!(res.0.entries[0].stage, "applied");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(issue_id(&st).await, None); // claim released
    }

    #[tokio::test]
    async fn no_linear_config_does_nothing() {
        let st = state(None).await;
        let _ = patch_tracker(State(st.clone()), patch("applied"))
            .await
            .unwrap();
        assert_eq!(issue_id(&st).await, None);
    }
}
