use axum::{
    extract::{Query, State},
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

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GoogleAuthCallbackQuery {
    pub code: String,
    pub state: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GoogleAuthCallbackResponse {
    pub connected: bool,
    pub provider: String,
    pub expires_at: Option<String>,
}

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
        (status = 200, description = "OAuth callback completed and encrypted token stored", body = GoogleAuthCallbackResponse),
        (status = 400, description = "Invalid OAuth state", body = crate::error::ErrorResponse)
    ),
    tag = "auth"
)]
pub async fn google_auth_callback(
    State(state): State<AppState>,
    Query(query): Query<GoogleAuthCallbackQuery>,
) -> Result<Json<GoogleAuthCallbackResponse>, AppError> {
    let expected_state = sqlx::query_scalar::<_, String>(
        "SELECT cursor_value FROM sync_cursors WHERE cursor_key = ?1",
    )
    .bind(OAUTH_STATE_CURSOR_KEY)
    .fetch_optional(&state.pool)
    .await?;

    if expected_state.as_deref() != Some(query.state.as_str()) {
        return Err(AppError::BadRequest(
            "invalid or expired OAuth state".to_string(),
        ));
    }

    sqlx::query("DELETE FROM sync_cursors WHERE cursor_key = ?1")
        .bind(OAUTH_STATE_CURSOR_KEY)
        .execute(&state.pool)
        .await?;

    let client = state.build_google_oauth_client().ok_or_else(|| {
        AppError::Config("Google OAuth credentials are not configured".to_string())
    })?;
    let cipher = state
        .cipher
        .as_ref()
        .ok_or_else(|| AppError::Config("CAREER_OS_TOKEN_KEY is not configured".to_string()))?;

    let tokens = client.exchange_code(&query.code).await?;
    store_google_tokens(&state.pool, cipher, None, &tokens).await?;
    let stored = load_google_token_row(&state.pool).await?;

    Ok(Json(GoogleAuthCallbackResponse {
        connected: true,
        provider: GOOGLE_PROVIDER_NAME.to_string(),
        expires_at: stored.and_then(|r| r.expires_at),
    }))
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
