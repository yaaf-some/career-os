use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{db::now_iso, error::AppError, state::AppState};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct SettingRecord {
    pub key: String,
    pub value_json: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListSettingsResponse {
    pub settings: Vec<SettingRecord>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpsertSettingRequest {
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct SyncRunRecord {
    pub id: String,
    pub run_type: String,
    pub status: String,
    pub items_fetched: i64,
    pub items_ingested: i64,
    pub items_filtered: i64,
    pub items_errored: i64,
    pub meta_json: Option<String>,
    pub error_message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListSyncRunsResponse {
    pub runs: Vec<SyncRunRecord>,
}

#[utoipa::path(
    get,
    path = "/api/settings",
    responses(
        (status = 200, description = "List settings", body = ListSettingsResponse)
    ),
    tag = "settings"
)]
pub async fn list_settings(
    State(state): State<AppState>,
) -> Result<Json<ListSettingsResponse>, AppError> {
    let settings = sqlx::query_as::<_, SettingRecord>(
        "SELECT key, value_json, updated_at FROM settings ORDER BY key ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListSettingsResponse { settings }))
}

#[utoipa::path(
    put,
    path = "/api/settings/{key}",
    params(
        ("key" = String, Path, description = "Setting key")
    ),
    request_body = UpsertSettingRequest,
    responses(
        (status = 200, description = "Setting saved", body = SettingRecord)
    ),
    tag = "settings"
)]
pub async fn upsert_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<UpsertSettingRequest>,
) -> Result<Json<SettingRecord>, AppError> {
    let value_json = serde_json::to_string(&req.value)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON value: {e}")))?;
    let now = now_iso();

    sqlx::query(
        r#"
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&key)
    .bind(&value_json)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    Ok(Json(SettingRecord {
        key,
        value_json,
        updated_at: now,
    }))
}

#[utoipa::path(
    get,
    path = "/api/sync-runs",
    responses(
        (status = 200, description = "Recent scheduler and manual sync runs", body = ListSyncRunsResponse)
    ),
    tag = "settings"
)]
pub async fn list_sync_runs(
    State(state): State<AppState>,
) -> Result<Json<ListSyncRunsResponse>, AppError> {
    let runs = sqlx::query_as::<_, SyncRunRecord>(
        r#"
        SELECT id, run_type, status, items_fetched, items_ingested, items_filtered,
               items_errored, meta_json, error_message, started_at, finished_at
        FROM sync_runs
        ORDER BY started_at DESC
        LIMIT 50
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListSyncRunsResponse { runs }))
}
