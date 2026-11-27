//! Gmail drafts and Calendar reminders for a job (JOB-6 PR B).
//! Gmail is **drafts only**: this module never sends mail; the user reviews and
//! sends from Gmail.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    integrations::gmail::DraftMessage,
    routes::jobs::{get_job, JobDetailResponse},
    state::AppState,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct EmailDraftRequest {
    pub to: String,
    pub subject: String,
    pub body: String,
    /// When true (and Google is connected), save it to Gmail Drafts. Never sends.
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarReminderRequest {
    pub title: String,
    /// RFC 3339 start time; the event lasts 30 minutes.
    pub starts_at: String,
    #[serde(default)]
    pub notes: String,
    /// `followup` (default, also sets the application's follow-up date), `prep` or `interview`.
    pub kind: Option<String>,
}

/// The application for a job, created at `shortlisted` if missing.
async fn ensure_application(state: &AppState, job_id: &str) -> Result<String, AppError> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM jobs WHERE id = ?1")
        .bind(job_id)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("job {job_id} not found")));
    }
    sqlx::query(
        "INSERT INTO applications (id, job_id, stage, updated_at) VALUES (?1, ?2, 'shortlisted', ?3)
         ON CONFLICT(job_id) DO NOTHING",
    )
    .bind(new_id())
    .bind(job_id)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;
    Ok(
        sqlx::query_scalar("SELECT id FROM applications WHERE job_id = ?1")
            .bind(job_id)
            .fetch_one(&state.pool)
            .await?,
    )
}

fn looks_like_email(to: &str) -> bool {
    let to = to.trim();
    to.len() <= 320
        && !to.contains(char::is_whitespace)
        && to
            .split_once('@')
            .is_some_and(|(u, d)| !u.is_empty() && d.contains('.'))
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/email-draft",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = EmailDraftRequest,
    responses(
        (status = 200, description = "Draft saved (and, if confirmed, saved to Gmail Drafts; never sent)", body = JobDetailResponse),
        (status = 400, description = "Invalid recipient or too long", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 409, description = "GOOGLE_NOT_CONNECTED / GOOGLE_RECONNECT_REQUIRED (draft kept locally)", body = crate::error::ErrorResponse)
    ),
    tag = "tracker"
)]
pub async fn save_email_draft(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(req): Json<EmailDraftRequest>,
) -> Result<Json<JobDetailResponse>, AppError> {
    if req.subject.len() > 998 || req.body.len() > 100_000 || req.to.len() > 320 {
        return Err(AppError::BadRequest("draft is too long".into()));
    }
    if req.confirmed && !looks_like_email(&req.to) {
        return Err(AppError::BadRequest(
            "recipient must be one email address".into(),
        ));
    }
    let app_id = ensure_application(&state, &job_id).await?;

    sqlx::query(
        r#"
        INSERT INTO email_drafts (id, application_id, to_email, subject, body, confirmed, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(application_id) DO UPDATE SET
            to_email = excluded.to_email,
            subject = excluded.subject,
            body = excluded.body,
            confirmed = excluded.confirmed,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(new_id())
    .bind(&app_id)
    .bind(req.to.trim())
    .bind(&req.subject)
    .bind(&req.body)
    .bind(req.confirmed)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    if req.confirmed {
        // Saved locally first, so a 409 here never loses the text.
        let token = state.require_google_access_token().await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT gmail_draft_id FROM email_drafts WHERE application_id = ?1")
                .bind(&app_id)
                .fetch_one(&state.pool)
                .await?;
        let msg = DraftMessage {
            to: req.to.trim(),
            subject: &req.subject,
            body: &req.body,
        };
        let draft_id = match existing {
            Some(id) => state.gmail.update_draft(&token, &id, &msg).await?,
            None => state.gmail.create_draft(&token, &msg).await?,
        };
        sqlx::query("UPDATE email_drafts SET gmail_draft_id = ?1 WHERE application_id = ?2")
            .bind(&draft_id)
            .bind(&app_id)
            .execute(&state.pool)
            .await?;
    }

    get_job(State(state), Path(job_id)).await
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/calendar-reminder",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = CalendarReminderRequest,
    responses(
        (status = 200, description = "Google Calendar event created and linked", body = JobDetailResponse),
        (status = 400, description = "Invalid time, title or kind", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 409, description = "GOOGLE_NOT_CONNECTED / GOOGLE_RECONNECT_REQUIRED", body = crate::error::ErrorResponse)
    ),
    tag = "tracker"
)]
pub async fn create_calendar_reminder(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(req): Json<CalendarReminderRequest>,
) -> Result<Json<JobDetailResponse>, AppError> {
    let title = req.title.trim();
    if title.is_empty() || title.len() > 200 || req.notes.len() > 8_000 {
        return Err(AppError::BadRequest(
            "title is required (max 200 chars)".into(),
        ));
    }
    let kind = req.kind.as_deref().unwrap_or("followup");
    if !matches!(kind, "followup" | "prep" | "interview") {
        return Err(AppError::BadRequest(format!("invalid kind: {kind}")));
    }
    let start = DateTime::parse_from_rfc3339(&req.starts_at)
        .map_err(|_| AppError::BadRequest("startsAt must be an RFC 3339 time".into()))?
        .with_timezone(&Utc);
    let starts_at = start.to_rfc3339_opts(SecondsFormat::Secs, true);
    let ends_at = (start + Duration::minutes(30)).to_rfc3339_opts(SecondsFormat::Secs, true);

    let app_id = ensure_application(&state, &job_id).await?;
    let token = state.require_google_access_token().await?;
    let notes = (!req.notes.trim().is_empty()).then_some(req.notes.as_str());
    let event = state
        .calendar
        .create_event(&token, title, notes, &starts_at, &ends_at)
        .await?;

    sqlx::query(
        r#"
        INSERT INTO calendar_events (id, gcal_event_id, application_id, kind, title, starts_at, ends_at, html_link, notes)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(gcal_event_id) DO UPDATE SET application_id = excluded.application_id
        "#,
    )
    .bind(new_id())
    .bind(&event.id)
    .bind(&app_id)
    .bind(kind)
    .bind(title)
    .bind(&starts_at)
    .bind(&ends_at)
    .bind(&event.html_link)
    .bind(notes)
    .execute(&state.pool)
    .await?;

    if kind == "followup" {
        sqlx::query("UPDATE applications SET next_followup_at = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(&starts_at)
            .bind(now_iso())
            .bind(&app_id)
            .execute(&state.pool)
            .await?;
    }

    get_job(State(state), Path(job_id)).await
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{extract::Request, http::StatusCode, response::IntoResponse, Router};
    use tokio::net::TcpListener;

    use super::*;
    use crate::{
        ai::MockAiProvider,
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
    };

    /// Fake Gmail + Calendar. Records every request line; never implements send.
    async fn fake_google() -> (String, Arc<Mutex<Vec<String>>>) {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let log = seen.clone();
        let app = Router::new().fallback(move |req: Request| {
            let log = log.clone();
            async move {
                let line = format!("{} {}", req.method(), req.uri().path());
                log.lock().unwrap().push(line.clone());
                match line.as_str() {
                    "POST /users/me/drafts" => {
                        axum::Json(serde_json::json!({"id": "draft-1"})).into_response()
                    }
                    "PUT /users/me/drafts/draft-1" => {
                        axum::Json(serde_json::json!({"id": "draft-1"})).into_response()
                    }
                    "POST /calendars/primary/events" => axum::Json(serde_json::json!({
                        "id": "gcal-1",
                        "htmlLink": "https://calendar.example.com/event/gcal-1",
                        "start": {"dateTime": "2026-12-01T17:00:00Z"},
                        "end": {"dateTime": "2026-12-01T17:30:00Z"}
                    }))
                    .into_response(),
                    _ => StatusCode::NOT_FOUND.into_response(),
                }
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}"), seen)
    }

    async fn state(google_base: &str, connected: bool) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type) VALUES ('job-1','k1','https://jobs.example.com/1','Example Co','Engineer','manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let cipher =
            TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        if connected {
            store_google_tokens(
                &pool,
                &cipher,
                Some("you@example.com"),
                &GoogleTokenResponse {
                    access_token: "test-access".into(),
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
                scheduler_enabled: false,
                ..AppConfig::default()
            }),
            ai: Arc::new(MockAiProvider),
            cipher: Some(cipher),
            scanner: ScannerClient::new(),
            gmail: GmailClient::new().with_base_url(google_base.to_string()),
            drive: DriveClient::new(),
            calendar: CalendarClient::new().with_base_url(google_base.to_string()),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
        }
    }

    fn draft(confirmed: bool, body: &str) -> EmailDraftRequest {
        EmailDraftRequest {
            to: "recruiting@example.com".into(),
            subject: "Re: next steps".into(),
            body: body.into(),
            confirmed,
        }
    }

    #[tokio::test]
    async fn email_draft_saves_locally_then_to_gmail_drafts_never_sends() {
        let (base, seen) = fake_google().await;
        let st = state(&base, true).await;

        // Unconfirmed: local only, no Google call.
        let d = save_email_draft(
            State(st.clone()),
            Path("job-1".into()),
            Json(draft(false, "v1")),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(d.email_draft.as_ref().unwrap().body, "v1");
        assert!(d.email_draft.as_ref().unwrap().gmail_draft_id.is_none());
        assert!(seen.lock().unwrap().is_empty());

        // Confirmed: create, then update the same Gmail draft.
        let d = save_email_draft(
            State(st.clone()),
            Path("job-1".into()),
            Json(draft(true, "v2")),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            d.email_draft.as_ref().unwrap().gmail_draft_id.as_deref(),
            Some("draft-1")
        );
        let _ = save_email_draft(
            State(st.clone()),
            Path("job-1".into()),
            Json(draft(true, "v3")),
        )
        .await
        .unwrap();
        let seen = seen.lock().unwrap().clone();
        assert_eq!(
            seen,
            ["POST /users/me/drafts", "PUT /users/me/drafts/draft-1"]
        );
        assert!(seen.iter().all(|l| !l.contains("send")));

        // Bad recipient rejected when sending to Gmail; unknown job is 404.
        let mut bad = draft(true, "x");
        bad.to = "not an email".into();
        let err = save_email_draft(State(st.clone()), Path("job-1".into()), Json(bad))
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().1, "BAD_REQUEST");
        let err = save_email_draft(State(st), Path("nope".into()), Json(draft(false, "x")))
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().1, "NOT_FOUND");
    }

    #[tokio::test]
    async fn email_draft_without_google_keeps_text_and_returns_409() {
        let (base, seen) = fake_google().await;
        let st = state(&base, false).await;
        let err = save_email_draft(
            State(st.clone()),
            Path("job-1".into()),
            Json(draft(true, "keep me")),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status_and_code().1, "GOOGLE_NOT_CONNECTED");
        let body: String = sqlx::query_scalar("SELECT body FROM email_drafts")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(body, "keep me");
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn calendar_reminder_creates_linked_event_and_sets_follow_up() {
        let (base, seen) = fake_google().await;
        let st = state(&base, true).await;
        let d = create_calendar_reminder(
            State(st.clone()),
            Path("job-1".into()),
            Json(CalendarReminderRequest {
                title: "Follow up with Example Co".into(),
                starts_at: "2026-12-01T09:00:00-08:00".into(),
                notes: "Ask about the panel".into(),
                kind: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            seen.lock().unwrap().as_slice(),
            ["POST /calendars/primary/events"]
        );
        let evt = &d.calendar_events[0];
        assert_eq!(evt.kind, "followup");
        assert_eq!(evt.starts_at, "2026-12-01T17:00:00Z");
        assert_eq!(evt.ends_at, "2026-12-01T17:30:00Z");
        assert_eq!(evt.notes.as_deref(), Some("Ask about the panel"));
        assert_eq!(
            d.application.as_ref().unwrap().next_followup_at.as_deref(),
            Some("2026-12-01T17:00:00Z")
        );

        // Prep reminders don't move the follow-up date; bad input is 400.
        for (starts_at, kind, code) in [
            ("tomorrow", None, "BAD_REQUEST"),
            ("2026-12-02T09:00:00Z", Some("party"), "BAD_REQUEST"),
        ] {
            let err = create_calendar_reminder(
                State(st.clone()),
                Path("job-1".into()),
                Json(CalendarReminderRequest {
                    title: "x".into(),
                    starts_at: starts_at.into(),
                    notes: String::new(),
                    kind: kind.map(str::to_string),
                }),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status_and_code().1, code);
        }
        let not_connected = state(&base, false).await;
        let err = create_calendar_reminder(
            State(not_connected),
            Path("job-1".into()),
            Json(CalendarReminderRequest {
                title: "x".into(),
                starts_at: "2026-12-02T09:00:00Z".into(),
                notes: String::new(),
                kind: Some("prep".into()),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status_and_code().1, "GOOGLE_NOT_CONNECTED");
    }
}
