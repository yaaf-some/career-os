//! Read-only integration status for the Settings view (JOB-11).

use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{error::AppError, routes::tracker::LINEAR_CLAIM, state::AppState};

const LINEAR_ISSUE_LIMIT: i64 = 20;

/// One application that has a Linear issue (stored identifier, e.g. `JOB-42`).
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct LinearIssueLink {
    pub identifier: String,
    pub job_id: String,
    pub company: String,
    pub title: String,
    pub updated_at: String,
}

/// Linear status. Never carries the API key or the team UUID.
#[derive(Debug, Serialize, ToSchema)]
pub struct LinearStatusResponse {
    /// `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are both set.
    pub configured: bool,
    /// Team key read from a stored identifier (`JOB` from `JOB-42`), if any.
    pub team_key: Option<String>,
    /// Up to 20 applications with an issue, newest first.
    pub issues: Vec<LinearIssueLink>,
}

#[utoipa::path(
    get,
    path = "/api/integrations/linear",
    responses(
        (status = 200, description = "Whether Linear is configured and which applications have issues", body = LinearStatusResponse)
    ),
    tag = "settings"
)]
pub async fn linear_status(
    State(state): State<AppState>,
) -> Result<Json<LinearStatusResponse>, AppError> {
    let configured = state.linear.is_some() && state.config.linear_team_id.is_some();
    let issues = sqlx::query_as::<_, LinearIssueLink>(
        r#"
        SELECT a.linear_issue_id AS identifier, j.id AS job_id, j.company, j.title,
               a.updated_at
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.linear_issue_id IS NOT NULL AND a.linear_issue_id <> ?1
        ORDER BY a.updated_at DESC
        LIMIT ?2
        "#,
    )
    .bind(LINEAR_CLAIM)
    .bind(LINEAR_ISSUE_LIMIT)
    .fetch_all(&state.pool)
    .await?;

    let team_key = issues.iter().find_map(|i| team_key_of(&i.identifier));
    Ok(Json(LinearStatusResponse {
        configured,
        team_key,
        issues,
    }))
}

/// `JOB` from `JOB-42`; `None` for anything not shaped like a Linear identifier.
fn team_key_of(identifier: &str) -> Option<String> {
    let (key, num) = identifier.split_once('-')?;
    let ok = !key.is_empty()
        && key.chars().all(|c| c.is_ascii_alphanumeric())
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit());
    ok.then(|| key.to_string())
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route(
        "/api/integrations/linear",
        axum::routing::get(linear_status),
    )
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(linear_status))]
pub struct Doc;

#[cfg(test)]
mod tests {
    use std::sync::Arc;

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

    async fn state(linear: bool) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        AppState {
            pool,
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                linear_api_key: linear.then(|| "lin_api_secret_value".to_string()),
                linear_team_id: linear.then(|| "team-uuid-secret".to_string()),
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
            linear: linear.then(|| LinearClient::new("lin_api_secret_value".to_string())),
        }
    }

    #[test]
    fn team_key_parsing() {
        assert_eq!(team_key_of("JOB-42").as_deref(), Some("JOB"));
        assert_eq!(team_key_of("creating"), None);
        assert_eq!(team_key_of("JOB-"), None);
        assert_eq!(team_key_of("-42"), None);
    }

    #[tokio::test]
    async fn unconfigured_returns_empty() {
        let res = linear_status(State(state(false).await)).await.unwrap().0;
        assert!(!res.configured);
        assert!(res.team_key.is_none());
        assert!(res.issues.is_empty());
    }

    #[tokio::test]
    async fn lists_stored_identifiers_without_secrets() {
        let state = state(true).await;
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type) VALUES
             ('j1', 'https://example.com/1', 'https://example.com/1', 'Acme', 'SRE', 'manual'),
             ('j2', 'https://example.com/2', 'https://example.com/2', 'Globex', 'Platform', 'manual'),
             ('j3', 'https://example.com/3', 'https://example.com/3', 'Initech', 'DevOps', 'manual')",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO applications (id, job_id, stage, linear_issue_id) VALUES
             ('a1', 'j1', 'applied', 'JOB-42'),
             ('a2', 'j2', 'applied', 'creating'),
             ('a3', 'j3', 'shortlisted', NULL)",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let res = linear_status(State(state)).await.unwrap().0;
        assert!(res.configured);
        assert_eq!(res.team_key.as_deref(), Some("JOB"));
        assert_eq!(res.issues.len(), 1);
        assert_eq!(res.issues[0].identifier, "JOB-42");
        assert_eq!(res.issues[0].company, "Acme");

        let body = serde_json::to_string(&res).unwrap();
        assert!(!body.contains("lin_api_secret_value"));
        assert!(!body.contains("team-uuid-secret"));
    }
}
