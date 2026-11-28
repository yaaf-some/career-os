use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    ai::{AiRouting, AI_ROUTING_KEY},
    db::now_iso,
    error::AppError,
    state::AppState,
};

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
        (status = 200, description = "Setting saved", body = SettingRecord),
        (status = 400, description = "Value invalid for a validated key (e.g. ai_routing)", body = crate::error::ErrorResponse)
    ),
    tag = "settings"
)]
pub async fn upsert_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<UpsertSettingRequest>,
) -> Result<Json<SettingRecord>, AppError> {
    validate_setting(&key, &req.value)?;
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

/// Commute origin read by `routes::commute` (a JSON string).
pub const HOME_LOCATION_AREA_KEY: &str = "home_location_area";
/// Commute travel mode read by `routes::commute` (`"drive"` or `"transit"`).
pub const TRAVEL_MODE_KEY: &str = "travel_mode";
const HOME_LOCATION_AREA_MAX_CHARS: usize = 120;

/// Keys with a known shape are validated so a bad write can't break their readers.
fn validate_setting(key: &str, value: &serde_json::Value) -> Result<(), AppError> {
    match key {
        AI_ROUTING_KEY => {
            serde_json::from_value::<AiRouting>(value.clone()).map_err(|e| {
                AppError::BadRequest(format!(
                    "ai_routing must be {{mode: auto|prefer_claude|prefer_agy}}: {e}"
                ))
            })?;
        }
        HOME_LOCATION_AREA_KEY => {
            let area = value.as_str().map(str::trim).unwrap_or_default();
            if area.is_empty() || area.chars().count() > HOME_LOCATION_AREA_MAX_CHARS {
                return Err(AppError::BadRequest(format!(
                    "home_location_area must be a non-empty string of at most {HOME_LOCATION_AREA_MAX_CHARS} characters"
                )));
            }
        }
        TRAVEL_MODE_KEY => {
            let mode = value.as_str().map(|m| m.trim().to_ascii_lowercase());
            if !matches!(mode.as_deref(), Some("drive" | "transit")) {
                return Err(AppError::BadRequest(
                    "travel_mode must be \"drive\" or \"transit\"".to_string(),
                ));
            }
        }
        _ => {}
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ai_routing_validation() {
        for ok in [
            json!({"mode": "auto"}),
            json!({"mode": "prefer_claude"}),
            json!({"mode": "prefer_agy"}),
        ] {
            assert!(validate_setting(AI_ROUTING_KEY, &ok).is_ok(), "{ok}");
        }
        for bad in [
            json!({"mode": "codex"}),
            json!({"mode": "auto", "x": 1}),
            json!({"hydrogenPrimary": "agy", "neonPrimary": "claude", "autoFailover": false}),
            json!("claude"),
        ] {
            assert!(
                matches!(
                    validate_setting(AI_ROUTING_KEY, &bad),
                    Err(AppError::BadRequest(_))
                ),
                "{bad}"
            );
        }
        // Other keys are free-form.
        assert!(validate_setting("anything", &json!({"a": 1})).is_ok());
        assert!(validate_setting("anything", &json!([1, 2])).is_ok());
    }

    #[test]
    fn commute_pref_validation() {
        for ok in [json!("drive"), json!("transit"), json!("Transit")] {
            assert!(validate_setting(TRAVEL_MODE_KEY, &ok).is_ok(), "{ok}");
        }
        for bad in [json!("bike"), json!(""), json!(1), json!({"mode": "drive"})] {
            assert!(
                matches!(
                    validate_setting(TRAVEL_MODE_KEY, &bad),
                    Err(AppError::BadRequest(_))
                ),
                "{bad}"
            );
        }
        assert!(validate_setting(HOME_LOCATION_AREA_KEY, &json!("West Los Angeles, CA")).is_ok());
        for bad in [json!(""), json!("   "), json!(42), json!("x".repeat(121))] {
            assert!(
                matches!(
                    validate_setting(HOME_LOCATION_AREA_KEY, &bad),
                    Err(AppError::BadRequest(_))
                ),
                "{bad}"
            );
        }
    }
}
