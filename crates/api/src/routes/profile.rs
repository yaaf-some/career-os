use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    error::AppError,
    profile::{load_profile, ProfileFileStatus, ProfileTargetingSummary},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocSummary {
    pub id: String,
    pub title: String,
    pub drive_url: Option<String>,
    pub modified_time: Option<String>,
    pub digested: bool,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatusResponse {
    pub loaded: bool,
    pub data_dir: String,
    pub drive_projects_folder_configured: bool,
    pub files: Vec<ProfileFileStatus>,
    pub targeting: Option<ProfileTargetingSummary>,
    pub project_docs: Vec<ProjectDocSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncProjectDocsResponse {
    pub docs_synced: i64,
    pub docs_digested: i64,
    pub skipped_unchanged: i64,
}

#[utoipa::path(
    get,
    path = "/api/profile/status",
    responses(
        (status = 200, description = "Read-only candidate profile and synced project docs status", body = ProfileStatusResponse)
    ),
    tag = "profile"
)]
pub async fn get_profile_status(
    State(state): State<AppState>,
) -> Result<Json<ProfileStatusResponse>, AppError> {
    let profile = load_profile(&state.config.data_dir);
    let targeting = profile.targeting_summary();
    let drive_projects_folder_configured = state
        .config
        .google_drive_projects_folder_id
        .as_deref()
        .is_some_and(|s| !s.trim().is_empty());

    let project_docs = sqlx::query_as::<_, ProjectDocSummary>(
        r#"
        SELECT id,
               title,
               drive_url,
               modified_time,
               (digest_json IS NOT NULL) AS digested,
               synced_at
        FROM project_docs
        ORDER BY title ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ProfileStatusResponse {
        loaded: profile.loaded,
        data_dir: profile.data_dir,
        drive_projects_folder_configured,
        files: profile.files,
        targeting,
        project_docs,
        warnings: profile.warnings,
    }))
}

#[utoipa::path(
    post,
    path = "/api/profile/sync-docs",
    responses(
        (status = 200, description = "Sync Google Docs from Project Reports folder and digest changed Docs", body = SyncProjectDocsResponse),
        (status = 409, description = "GOOGLE_NOT_CONNECTED or DRIVE_FOLDER_NOT_CONFIGURED", body = crate::error::ErrorResponse)
    ),
    tag = "profile"
)]
pub async fn sync_project_docs_now(
    State(state): State<AppState>,
) -> Result<Json<SyncProjectDocsResponse>, AppError> {
    if state
        .config
        .google_drive_projects_folder_id
        .as_deref()
        .is_none_or(|s| s.trim().is_empty())
    {
        return Err(AppError::ConflictCode(
            "DRIVE_FOLDER_NOT_CONFIGURED",
            "GOOGLE_DRIVE_PROJECTS_FOLDER_ID is not configured".into(),
        ));
    }

    let access_token = state.require_google_access_token().await?;
    let outcome = state.sync_project_docs(&access_token).await?;
    Ok(Json(SyncProjectDocsResponse {
        docs_synced: outcome.docs_synced,
        docs_digested: outcome.docs_digested,
        skipped_unchanged: outcome.skipped_unchanged,
    }))
}
