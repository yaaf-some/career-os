use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::AppError,
    profile::{load_profile, ProfileFileStatus, ProfileTargetingSummary},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
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
    pub files: Vec<ProfileFileStatus>,
    pub targeting: Option<ProfileTargetingSummary>,
    pub project_docs: Vec<ProjectDocSummary>,
    pub warnings: Vec<String>,
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
    Ok(Json(ProfileStatusResponse {
        loaded: profile.loaded,
        data_dir: profile.data_dir,
        files: profile.files,
        targeting,
        project_docs: Vec::new(),
        warnings: profile.warnings,
    }))
}
