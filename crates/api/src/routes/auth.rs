use axum::{
    extract::{Query, State},
    response::Redirect,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{
    db::now_iso,
    error::AppError,
    integrations::google_auth::{
        compute_testing_status, load_google_token_row, missing_scopes, store_google_tokens,
        DEFAULT_GOOGLE_SCOPES, GOOGLE_PROVIDER_NAME,
    },
    state::AppState,
};

const OAUTH_STATE_CURSOR_KEY: &str = "google_oauth_state";

#[derive(Debug, Serialize, ToSchema)]
pub struct GoogleAuthStatusResponse {
    pub connected: bool,
    pub auth_mode: String,
    pub account_email: Option<String>,
    pub connected_at: Option<String>,
    pub testing_expires_at: Option<String>,
    pub hours_remaining: Option<i64>,
    pub needs_reconnect: bool,
    pub expires_at: Option<String>,
    pub oauth_configured: bool,
    pub encryption_configured: bool,
    /// Default scopes the current grant lacks; reconnect to grant them.
    pub missing_scopes: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GoogleAuthUrlResponse {
    pub url: String,
    pub state: String,
}

/// Google's redirect: `code` + `state` on consent, `error` (e.g. `access_denied`) otherwise.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GoogleAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Where the browser lands after the OAuth callback (the SPA's Settings route).
const SETTINGS_PATH: &str = "/settings";

#[utoipa::path(
    get,
    path = "/api/auth/google/status",
    responses(
        (status = 200, description = "Google OAuth connection status (including 7-day Testing-mode countdown)", body = GoogleAuthStatusResponse)
    ),
    tag = "auth"
)]
pub async fn google_auth_status(
    State(state): State<AppState>,
) -> Result<Json<GoogleAuthStatusResponse>, AppError> {
    let row = load_google_token_row(&state.pool).await?;
    let connected = row.is_some();
    let missing_scopes = missing_scopes(row.as_ref().and_then(|r| r.scope.as_deref()));
    let testing = compute_testing_status(
        connected,
        row.as_ref().and_then(|r| r.connected_at.as_deref()),
        row.as_ref().map(|r| r.updated_at.as_str()),
        Utc::now(),
    );

    Ok(Json(GoogleAuthStatusResponse {
        connected,
        auth_mode: testing.auth_mode,
        account_email: row.as_ref().and_then(|r| r.account_email.clone()),
        connected_at: testing.connected_at,
        testing_expires_at: testing.testing_expires_at,
        hours_remaining: testing.hours_remaining,
        needs_reconnect: testing.needs_reconnect,
        expires_at: row.and_then(|r| r.expires_at),
        oauth_configured: state.build_google_oauth_client().is_some(),
        encryption_configured: state.cipher.is_some(),
        missing_scopes,
    }))
}

#[utoipa::path(
    get,
    path = "/api/auth/google/url",
    responses(
        (status = 200, description = "Generate Google OAuth authorization URL", body = GoogleAuthUrlResponse),
        (status = 500, description = "Google OAuth not configured", body = crate::error::ErrorResponse)
    ),
    tag = "auth"
)]
pub async fn google_auth_url(
    State(state): State<AppState>,
) -> Result<Json<GoogleAuthUrlResponse>, AppError> {
    let client = state.build_google_oauth_client().ok_or_else(|| {
        AppError::Config("Google OAuth credentials are not configured".to_string())
    })?;

    let csrf_state = crate::db::new_id();
    sqlx::query(
        r#"
        INSERT INTO sync_cursors (cursor_key, cursor_value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(cursor_key) DO UPDATE SET
            cursor_value = excluded.cursor_value,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(OAUTH_STATE_CURSOR_KEY)
    .bind(&csrf_state)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    let url = client.build_authorization_url(&csrf_state, DEFAULT_GOOGLE_SCOPES)?;
    Ok(Json(GoogleAuthUrlResponse {
        url,
        state: csrf_state,
    }))
}

#[utoipa::path(
    get,
    path = "/api/auth/google/callback",
    params(GoogleAuthCallbackQuery),
    responses(
        (status = 303, description = "Redirects to `/settings?google=connected`, or `/settings?google=error&reason=<denied|invalid_state|not_configured|exchange_failed>`")
    ),
    tag = "auth"
)]
pub async fn google_auth_callback(
    State(state): State<AppState>,
    Query(query): Query<GoogleAuthCallbackQuery>,
) -> Redirect {
    let result = complete_google_callback(&state, &query).await;
    if let Err(err) = &result {
        tracing::warn!(error = %err, "google oauth callback failed");
    }
    callback_redirect(&result)
}

/// Maps the callback outcome to a Settings URL. Fixed reason codes only: raw
/// error text never goes into the URL (history, logs, referrers).
fn callback_redirect(result: &Result<(), CallbackError>) -> Redirect {
    let target = match result {
        Ok(()) => format!("{SETTINGS_PATH}?google=connected"),
        Err(err) => format!("{SETTINGS_PATH}?google=error&reason={}", err.reason()),
    };
    Redirect::to(&target)
}

#[derive(Debug, thiserror::Error)]
enum CallbackError {
    #[error("google returned no code (error: {0})")]
    Denied(String),
    #[error(transparent)]
    App(#[from] AppError),
}

impl CallbackError {
    fn reason(&self) -> &'static str {
        match self {
            Self::Denied(_) => "denied",
            Self::App(AppError::BadRequest(_)) => "invalid_state",
            Self::App(AppError::Config(_)) => "not_configured",
            Self::App(_) => "exchange_failed",
        }
    }
}

async fn complete_google_callback(
    state: &AppState,
    query: &GoogleAuthCallbackQuery,
) -> Result<(), CallbackError> {
    let expected_state = sqlx::query_scalar::<_, String>(
        "SELECT cursor_value FROM sync_cursors WHERE cursor_key = ?1",
    )
    .bind(OAUTH_STATE_CURSOR_KEY)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?;

    if expected_state.is_none() || expected_state.as_deref() != query.state.as_deref() {
        return Err(AppError::BadRequest("invalid or expired OAuth state".to_string()).into());
    }

    // The state is single-use whether consent was granted or not.
    sqlx::query("DELETE FROM sync_cursors WHERE cursor_key = ?1")
        .bind(OAUTH_STATE_CURSOR_KEY)
        .execute(&state.pool)
        .await
        .map_err(AppError::from)?;

    let Some(code) = query.code.as_deref().filter(|c| !c.is_empty()) else {
        return Err(CallbackError::Denied(
            query
                .error
                .clone()
                .unwrap_or_else(|| "missing code".to_string()),
        ));
    };

    let client = state.build_google_oauth_client().ok_or_else(|| {
        AppError::Config("Google OAuth credentials are not configured".to_string())
    })?;
    let cipher = state
        .cipher
        .as_ref()
        .ok_or_else(|| AppError::Config("CAREER_OS_TOKEN_KEY is not configured".to_string()))?;

    let tokens = client.exchange_code(code).await?;
    store_google_tokens(&state.pool, cipher, None, &tokens).await?;
    Ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GoogleAuthDisconnectResponse {
    pub connected: bool,
}

#[utoipa::path(
    post,
    path = "/api/auth/google/disconnect",
    responses(
        (status = 200, description = "Google OAuth token removed", body = GoogleAuthDisconnectResponse)
    ),
    tag = "auth"
)]
pub async fn google_auth_disconnect(
    State(state): State<AppState>,
) -> Result<Json<GoogleAuthDisconnectResponse>, AppError> {
    sqlx::query("DELETE FROM oauth_tokens WHERE provider = ?1")
        .bind(GOOGLE_PROVIDER_NAME)
        .execute(&state.pool)
        .await?;
    Ok(Json(GoogleAuthDisconnectResponse { connected: false }))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/api/auth/google/status",
            axum::routing::get(google_auth_status),
        )
        .route("/api/auth/google/url", axum::routing::get(google_auth_url))
        .route(
            "/api/auth/google/callback",
            axum::routing::get(google_auth_callback),
        )
        .route(
            "/api/auth/google/disconnect",
            axum::routing::post(google_auth_disconnect),
        )
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(
    google_auth_status,
    google_auth_url,
    google_auth_callback,
    google_auth_disconnect
))]
pub struct Doc;

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{http::header::LOCATION, response::IntoResponse};

    use super::*;
    use crate::{
        ai::MockAiProvider,
        config::AppConfig,
        db::init_pool,
        integrations::{
            calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, maps::MapsClient,
            scanner::ScannerClient,
        },
    };

    async fn state_with_oauth_state(value: Option<&str>) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        if let Some(v) = value {
            sqlx::query("INSERT INTO sync_cursors (cursor_key, cursor_value) VALUES (?1, ?2)")
                .bind(OAUTH_STATE_CURSOR_KEY)
                .bind(v)
                .execute(&pool)
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
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
            linear: None,
        }
    }

    async fn location(state: AppState, query: GoogleAuthCallbackQuery) -> (u16, String) {
        let res = google_auth_callback(State(state), Query(query))
            .await
            .into_response();
        let loc = res.headers()[LOCATION].to_str().unwrap().to_string();
        (res.status().as_u16(), loc)
    }

    fn query(
        code: Option<&str>,
        state: Option<&str>,
        error: Option<&str>,
    ) -> GoogleAuthCallbackQuery {
        GoogleAuthCallbackQuery {
            code: code.map(str::to_string),
            state: state.map(str::to_string),
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn success_redirects_to_settings_connected() {
        let res = callback_redirect(&Ok(())).into_response();
        assert_eq!(res.status().as_u16(), 303);
        assert_eq!(res.headers()[LOCATION], "/settings?google=connected");
    }

    #[tokio::test]
    async fn bad_or_missing_state_redirects_invalid_state() {
        for (stored, sent) in [(Some("good"), Some("bad")), (None, Some("x")), (None, None)] {
            let (status, loc) = location(
                state_with_oauth_state(stored).await,
                query(Some("c"), sent, None),
            )
            .await;
            assert_eq!(status, 303);
            assert_eq!(loc, "/settings?google=error&reason=invalid_state");
        }
    }

    #[tokio::test]
    async fn consent_denied_redirects_denied_and_consumes_state() {
        let state = state_with_oauth_state(Some("s1")).await;
        let (_, loc) = location(
            state.clone(),
            query(None, Some("s1"), Some("access_denied")),
        )
        .await;
        assert_eq!(loc, "/settings?google=error&reason=denied");
        let left: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_cursors WHERE cursor_key = ?1")
                .bind(OAUTH_STATE_CURSOR_KEY)
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn unconfigured_oauth_redirects_not_configured() {
        let (_, loc) = location(
            state_with_oauth_state(Some("s1")).await,
            query(Some("code"), Some("s1"), None),
        )
        .await;
        assert_eq!(loc, "/settings?google=error&reason=not_configured");
    }
}
