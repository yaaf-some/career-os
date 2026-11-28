//! Today view, manual Google sync and manual thread linking (JOB-6).
//! Responses are camelCase; job rows inside them use the API job shape
//! (`JobRecord`), which the web maps with `web/src/api/jobs.ts`.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    error::AppError,
    integrations::google_auth::load_google_token_row,
    routes::{jobs::JobRecord, settings::SyncRunRecord},
    scheduler::run_google_sync,
    state::AppState,
};

#[derive(Debug, Serialize, Deserialize, FromRow, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodayReplyItem {
    pub thread_id: String,
    pub job_id: String,
    pub company: String,
    pub role: String,
    pub sender: String,
    pub subject: String,
    pub snippet: String,
    pub received_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodayAgendaItem {
    pub id: String,
    pub job_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub html_link: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodayFollowUpItem {
    pub job_id: String,
    pub company: String,
    pub role: String,
    pub due_at: String,
    pub overdue: bool,
    /// DB stage (`shortlisted|applied|recruiter|interviewing|offer|closed`).
    pub stage: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TodayResponse {
    /// UTC calendar date, `YYYY-MM-DD`.
    pub date: String,
    pub unread_replies: Vec<TodayReplyItem>,
    pub agenda: Vec<TodayAgendaItem>,
    pub follow_ups_due: Vec<TodayFollowUpItem>,
    /// Best-scored jobs still in triage (API job shape).
    pub top_matches: Vec<JobRecord>,
}

pub async fn build_today(
    pool: &sqlx::SqlitePool,
    now: chrono::DateTime<Utc>,
) -> Result<TodayResponse, AppError> {
    let now_s = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let end_of_day = now.date_naive().and_hms_opt(23, 59, 59).unwrap().and_utc();
    let end_of_day_s = end_of_day.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let week_s = (now + Duration::days(7)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let unread_replies = sqlx::query_as::<_, TodayReplyItem>(
        r#"
        SELECT t.id AS thread_id, j.id AS job_id, j.company, j.title AS role,
               COALESCE(t.from_email, '') AS sender, COALESCE(t.subject, '') AS subject,
               COALESCE(t.snippet, '') AS snippet,
               COALESCE(t.last_message_at, t.synced_at) AS received_at
        FROM gmail_threads t
        JOIN applications a ON a.id = t.application_id
        JOIN jobs j ON j.id = a.job_id
        WHERE t.needs_reply = 1
        ORDER BY received_at DESC
        LIMIT 20
        "#,
    )
    .fetch_all(pool)
    .await?;

    let agenda = sqlx::query_as::<_, TodayAgendaItem>(
        r#"
        SELECT e.id, a.job_id, e.kind, e.title, e.starts_at, e.ends_at, e.html_link
        FROM calendar_events e
        LEFT JOIN applications a ON a.id = e.application_id
        WHERE e.ends_at >= ?1 AND e.starts_at <= ?2
        ORDER BY e.starts_at ASC
        LIMIT 30
        "#,
    )
    .bind(&now_s)
    .bind(&week_s)
    .fetch_all(pool)
    .await?;

    let follow_ups_due = sqlx::query_as::<_, TodayFollowUpItem>(
        r#"
        SELECT j.id AS job_id, j.company, j.title AS role, a.next_followup_at AS due_at,
               (a.next_followup_at < ?1) AS overdue, a.stage
        FROM applications a JOIN jobs j ON j.id = a.job_id
        WHERE a.next_followup_at IS NOT NULL AND a.next_followup_at <= ?2
          AND a.stage <> 'closed'
        ORDER BY a.next_followup_at ASC
        LIMIT 30
        "#,
    )
    .bind(&now_s)
    .bind(&end_of_day_s)
    .fetch_all(pool)
    .await?;

    let top_matches = sqlx::query_as::<_, JobRecord>(
        r#"
        SELECT id, canonical_key, url, company, title, location, workplace_type,
               yoe_min, yoe_max, yoe_label, salary_min, salary_max, salary_currency,
               posted_at, source_type, source_id, jd_text, guard_flags_json,
               triage_status, tier1_score, tier1_json, created_at, updated_at
        FROM jobs
        WHERE triage_status IN ('pending_triage', 'shortlisted') AND tier1_score IS NOT NULL
        ORDER BY tier1_score DESC
        LIMIT 5
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(TodayResponse {
        date: now.format("%Y-%m-%d").to_string(),
        unread_replies,
        agenda,
        follow_ups_due,
        top_matches,
    })
}

#[utoipa::path(
    get,
    path = "/api/today",
    responses((status = 200, description = "Replies, agenda, follow-ups due and top matches", body = TodayResponse)),
    tag = "tracker"
)]
pub async fn get_today(State(state): State<AppState>) -> Result<Json<TodayResponse>, AppError> {
    Ok(Json(build_today(&state.pool, Utc::now()).await?))
}

#[utoipa::path(
    post,
    path = "/api/sync/google",
    responses(
        (status = 200, description = "Ran one Gmail/Calendar sync; the recorded run", body = SyncRunRecord),
        (status = 409, description = "GOOGLE_NOT_CONNECTED or SYNC_IN_PROGRESS", body = crate::error::ErrorResponse)
    ),
    tag = "settings"
)]
pub async fn sync_google_now(
    State(state): State<AppState>,
) -> Result<Json<SyncRunRecord>, AppError> {
    if state.cipher.is_none() || load_google_token_row(&state.pool).await?.is_none() {
        return Err(AppError::ConflictCode(
            "GOOGLE_NOT_CONNECTED",
            "Google is not connected; connect it in Settings first".into(),
        ));
    }
    Ok(Json(run_google_sync(&state).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkThreadRequest {
    /// Application to link to, or null to unlink. Either way the link becomes manual.
    pub application_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkThreadResponse {
    pub id: String,
    pub application_id: Option<String>,
    pub link_source: String,
}

#[utoipa::path(
    put,
    path = "/api/gmail-threads/{id}/application",
    params(("id" = String, Path, description = "gmail_threads row id")),
    request_body = LinkThreadRequest,
    responses(
        (status = 200, description = "Thread linked manually (kept across syncs)", body = LinkThreadResponse),
        (status = 404, description = "Thread or application not found", body = crate::error::ErrorResponse)
    ),
    tag = "tracker"
)]
pub async fn link_thread(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<LinkThreadRequest>,
) -> Result<Json<LinkThreadResponse>, AppError> {
    if let Some(app_id) = &req.application_id {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM applications WHERE id = ?1")
                .bind(app_id)
                .fetch_optional(&state.pool)
                .await?;
        if exists.is_none() {
            return Err(AppError::NotFound(format!(
                "application {app_id} not found"
            )));
        }
    }
    let res = sqlx::query(
        "UPDATE gmail_threads SET application_id = ?1, link_source = 'manual' WHERE id = ?2",
    )
    .bind(&req.application_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("thread {id} not found")));
    }
    Ok(Json(LinkThreadResponse {
        id,
        application_id: req.application_id,
        link_source: "manual".into(),
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::routes::tracker::list_tracker_entries;

    /// Seeds two applications (one with a reply waiting, an interview and an
    /// overdue follow-up), one scored job in triage and one unlinked thread.
    pub(crate) async fn seeded_pool() -> sqlx::SqlitePool {
        let pool = crate::db::init_pool("sqlite::memory:").await.unwrap();
        for sql in [
            r#"INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, tier1_score, created_at, updated_at) VALUES
               ('job-1','k1','https://jobs.example.com/staff','Example Co','Staff Platform Engineer','manual','shortlisted',87.5,'2026-11-20T09:00:00Z','2026-11-20T09:00:00Z'),
               ('job-2','k2','https://boards.greenhouse.io/globex/2','Globex','Backend Engineer','ats_board','shortlisted',72,'2026-11-21T09:00:00Z','2026-11-21T09:00:00Z'),
               ('job-3','k3','https://jobs.example.com/sre','Initech','Site Reliability Engineer','manual','pending_triage',91,'2026-11-22T09:00:00Z','2026-11-22T09:00:00Z'),
               ('job-4','k4','https://jobs.example.com/unscored','Hooli','Data Engineer','manual','pending_scoring',NULL,'2026-11-23T09:00:00Z','2026-11-23T09:00:00Z')"#,
            r#"INSERT INTO applications (id, job_id, stage, next_followup_at, notes, updated_at) VALUES
               ('app-1','job-1','interviewing','2026-11-27T09:00:00Z','Panel next week','2026-11-24T10:00:00Z'),
               ('app-2','job-2','applied',NULL,NULL,'2026-11-22T10:00:00Z')"#,
            r#"INSERT INTO gmail_threads (id, thread_id, application_id, subject, from_email, snippet, needs_reply, last_message_at, synced_at) VALUES
               ('thr-1','g1','app-1','Example Co: next steps','Recruiter <recruiting@example.com>','Are you free Tuesday?',1,'2026-11-26T15:00:00Z','2026-11-26T16:00:00Z'),
               ('thr-2','g2','app-2','Globex application received','no-reply@greenhouse.io','Thanks for applying to Globex',0,'2026-11-23T08:00:00Z','2026-11-26T16:00:00Z'),
               ('thr-3','g3',NULL,'Newsletter','news@example.org','Weekly digest',1,'2026-11-26T07:00:00Z','2026-11-26T16:00:00Z')"#,
            r#"INSERT INTO calendar_events (id, gcal_event_id, application_id, kind, title, starts_at, ends_at, html_link) VALUES
               ('evt-1','c1','app-1','interview','Example Co interview','2026-11-29T17:00:00Z','2026-11-29T18:00:00Z','https://calendar.example.com/event/1'),
               ('evt-2','c2',NULL,'interview','Dentist','2026-11-28T09:00:00Z','2026-11-28T10:00:00Z',NULL),
               ('evt-3','c3','app-2','followup','Globex follow-up','2026-12-20T09:00:00Z','2026-12-20T09:30:00Z',NULL)"#,
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        pool
    }

    pub(crate) fn fixed_now() -> chrono::DateTime<Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-11-27T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn check_fixture(name: &str, value: &impl Serialize) {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/src/__tests__/fixtures")
            .join(name);
        let actual = serde_json::to_string_pretty(value).unwrap() + "\n";
        if std::env::var("UPDATE_FIXTURES").as_deref() == Ok("1") {
            std::fs::write(&path, &actual).unwrap();
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("missing {}: {e}", path.display()));
        assert_eq!(
            actual, expected,
            "{name} out of date; rerun with UPDATE_FIXTURES=1"
        );
    }

    #[tokio::test]
    async fn today_collects_replies_agenda_followups_and_matches() {
        let pool = seeded_pool().await;
        let today = build_today(&pool, fixed_now()).await.unwrap();
        assert_eq!(today.date, "2026-11-27");
        // Only linked threads that need a reply.
        assert_eq!(
            today
                .unread_replies
                .iter()
                .map(|r| r.thread_id.as_str())
                .collect::<Vec<_>>(),
            ["thr-1"]
        );
        // Next 7 days, linked or not, soonest first; the December event is out.
        assert_eq!(
            today
                .agenda
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["evt-2", "evt-1"]
        );
        assert_eq!(today.agenda[1].job_id.as_deref(), Some("job-1"));
        assert_eq!(today.follow_ups_due.len(), 1);
        assert!(today.follow_ups_due[0].overdue);
        assert_eq!(
            today
                .top_matches
                .iter()
                .map(|j| j.id.as_str())
                .collect::<Vec<_>>(),
            ["job-3", "job-1", "job-2"]
        );
    }

    #[tokio::test]
    async fn tracker_rows_carry_thread_activity() {
        let pool = seeded_pool().await;
        let entries = list_tracker_entries(&pool).await.unwrap();
        assert_eq!(entries.len(), 2);
        let first = &entries[0];
        assert_eq!(first.job_id, "job-1");
        assert_eq!(
            first.thread_subject.as_deref(),
            Some("Example Co: next steps")
        );
        assert!(first.threads_need_reply);
        assert_eq!(first.last_activity_at, "2026-11-26T15:00:00Z");
        assert_eq!(entries[1].notes, "");
    }

    /// The web tests read these files. Regenerate with
    /// `UPDATE_FIXTURES=1 cargo test -p career-os-api workspace_fixtures`.
    #[tokio::test]
    async fn workspace_fixtures_match_web() {
        let pool = seeded_pool().await;
        check_fixture(
            "today.json",
            &build_today(&pool, fixed_now()).await.unwrap(),
        );
        check_fixture(
            "tracker.json",
            &crate::routes::tracker::TrackerResponse {
                entries: list_tracker_entries(&pool).await.unwrap(),
            },
        );
    }
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/api/today", axum::routing::get(get_today))
        .route("/api/sync/google", axum::routing::post(sync_google_now))
        .route(
            "/api/gmail-threads/{id}/application",
            axum::routing::put(link_thread),
        )
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(get_today, sync_google_now, link_thread))]
pub struct Doc;
