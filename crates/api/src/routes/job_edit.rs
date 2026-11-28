//! Editing, archiving, notes and tags for one job (unit 2).
//!
//! A later scan never overwrites these edits: ingest does nothing on a known
//! `canonical_key` apart from completing a missing or cut-off description.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    integrations::scanner::canonicalize_url_key,
    routes::jobs::{JobRecord, JOB_COLUMNS},
    state::AppState,
};

const MAX_TITLE_CHARS: usize = 300;
const MAX_COMPANY_CHARS: usize = 200;
const MAX_LOCATION_CHARS: usize = 300;
const MAX_YOE_LABEL_CHARS: usize = 100;
const MAX_URL_BYTES: usize = 2048;
const MAX_SALARY: i64 = 1_000_000_000;
const MAX_NOTE_CHARS: usize = 10_000;
const MAX_TAG_CHARS: usize = 40;
const MAX_TAGS_PER_JOB: i64 = 30;
const WORKPLACE_TYPES: [&str; 4] = ["remote", "hybrid", "onsite", "unknown"];

/// Tells a field that was left out (unchanged) from one sent as `null` (cleared).
fn nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Only the fields that are sent change. `null` clears an optional field.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateJobRequest {
    pub title: Option<String>,
    pub company: Option<String>,
    pub url: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub location: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub workplace_type: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<i64>)]
    pub salary_min: Option<Option<i64>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<i64>)]
    pub salary_max: Option<Option<i64>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub salary_currency: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub yoe_label: Option<Option<String>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ArchiveJobRequest {
    pub archived: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeleteJobQuery {
    /// Must be `true`: deleting a job cannot be undone.
    pub confirm: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteJobResponse {
    pub deleted: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobNote {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

/// The user's own notes (newest first) and tags (alphabetical) for one job.
#[derive(Debug, Serialize, ToSchema)]
pub struct JobAnnotations {
    pub notes: Vec<JobNote>,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NoteRequest {
    pub body: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TagRequest {
    pub tag: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameTagRequest {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RemoveTagQuery {
    pub tag: String,
}

fn bad(message: impl Into<String>) -> AppError {
    AppError::BadRequest(message.into())
}

fn job_not_found(id: &str) -> AppError {
    AppError::NotFound(format!("job {id} not found"))
}

/// One line of text: trimmed, no control characters, at most `max` characters.
fn line(field: &str, value: &str, max: usize) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().any(char::is_control) {
        return Err(bad(format!("{field} must be a single line of text")));
    }
    if value.chars().count() > max {
        return Err(bad(format!("{field} must be at most {max} characters")));
    }
    Ok(value.to_string())
}

fn required_line(field: &str, value: &str, max: usize) -> Result<String, AppError> {
    let value = line(field, value, max)?;
    if value.is_empty() {
        return Err(bad(format!("{field} cannot be empty")));
    }
    Ok(value)
}

/// Blank text clears the field.
fn optional_line(field: &str, value: Option<&str>, max: usize) -> Result<Option<String>, AppError> {
    match value {
        Some(value) => Ok(Some(line(field, value, max)?).filter(|v| !v.is_empty())),
        None => Ok(None),
    }
}

fn posting_url(raw: &str) -> Result<String, AppError> {
    let url = raw.trim();
    let invalid = || bad("url must be an http(s) URL");
    let lower = url.to_ascii_lowercase();
    if url.len() > MAX_URL_BYTES
        || !(lower.starts_with("https://") || lower.starts_with("http://"))
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(invalid());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid())?;
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(invalid());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(bad("url must not contain a user name or password"));
    }
    Ok(url.to_string())
}

fn salary(field: &str, value: Option<i64>) -> Result<Option<i64>, AppError> {
    if value.is_some_and(|v| !(0..=MAX_SALARY).contains(&v)) {
        return Err(bad(format!("{field} must be between 0 and {MAX_SALARY}")));
    }
    Ok(value)
}

fn currency(value: Option<&str>) -> Result<Option<String>, AppError> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(code) if code.len() == 3 && code.bytes().all(|b| b.is_ascii_alphabetic()) => {
            Ok(Some(code.to_ascii_uppercase()))
        }
        Some(_) => Err(bad("salary_currency must be a 3-letter code such as USD")),
        None => Ok(None),
    }
}

fn workplace(value: Option<&str>) -> Result<Option<String>, AppError> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) if WORKPLACE_TYPES.contains(&v) => Ok(Some(v.to_string())),
        Some(_) => Err(bad(
            "workplace_type must be remote, hybrid, onsite or unknown",
        )),
        None => Ok(None),
    }
}

async fn load_job(state: &AppState, id: &str) -> Result<JobRecord, AppError> {
    sqlx::query_as::<_, JobRecord>(sqlx::AssertSqlSafe(format!(
        "SELECT {JOB_COLUMNS} FROM jobs WHERE id = ?1"
    )))
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| job_not_found(id))
}

async fn require_job(state: &AppState, id: &str) -> Result<(), AppError> {
    sqlx::query_scalar::<_, i64>("SELECT 1 FROM jobs WHERE id = ?1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .map(|_| ())
        .ok_or_else(|| job_not_found(id))
}

/// The `canonical_key` a job should have once its URL becomes `new_url`.
///
/// The key is what a scan uses to recognize a posting. A job a scan found keeps
/// it, so the next scan of the same board does not bring the posting back as a
/// second job. A job added by hand follows its new URL, so adding that URL again
/// finds this job.
async fn key_for_new_url(
    state: &AppState,
    job: &JobRecord,
    new_url: &str,
) -> Result<String, AppError> {
    let new_key = canonicalize_url_key(new_url);
    if new_key == canonicalize_url_key(&job.url) {
        return Ok(job.canonical_key.clone());
    }
    let other: Option<(String, String)> = sqlx::query_as(
        "SELECT title, company FROM jobs \
         WHERE id != ?1 AND (canonical_key = ?2 OR rtrim(lower(url), '/') = ?2) LIMIT 1",
    )
    .bind(&job.id)
    .bind(&new_key)
    .fetch_optional(&state.pool)
    .await?;
    if let Some((title, company)) = other {
        return Err(AppError::Conflict(format!(
            "Another job already uses this URL: {title} at {company}"
        )));
    }
    Ok(if job.source_type == "manual" {
        new_key
    } else {
        job.canonical_key.clone()
    })
}

#[utoipa::path(
    patch,
    path = "/api/jobs/{id}",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "Edit a job's own fields", body = JobRecord),
        (status = 400, description = "Invalid value", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 409, description = "Another job has this URL", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn update_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateJobRequest>,
) -> Result<Json<JobRecord>, AppError> {
    let mut job = load_job(&state, &id).await?;

    if let Some(title) = &req.title {
        job.title = required_line("title", title, MAX_TITLE_CHARS)?;
    }
    if let Some(company) = &req.company {
        job.company = required_line("company", company, MAX_COMPANY_CHARS)?;
    }
    if let Some(location) = &req.location {
        job.location = optional_line("location", location.as_deref(), MAX_LOCATION_CHARS)?;
    }
    if let Some(value) = &req.workplace_type {
        job.workplace_type = workplace(value.as_deref())?;
    }
    if let Some(value) = req.salary_min {
        job.salary_min = salary("salary_min", value)?;
    }
    if let Some(value) = req.salary_max {
        job.salary_max = salary("salary_max", value)?;
    }
    if let Some(value) = &req.salary_currency {
        job.salary_currency = currency(value.as_deref())?;
    }
    if let Some(value) = &req.yoe_label {
        let label = optional_line("yoe_label", value.as_deref(), MAX_YOE_LABEL_CHARS)?;
        // The parsed numbers described the old label.
        if label != job.yoe_label {
            job.yoe_min = None;
            job.yoe_max = None;
        }
        job.yoe_label = label;
    }
    if (req.salary_min.is_some() || req.salary_max.is_some())
        && matches!((job.salary_min, job.salary_max), (Some(min), Some(max)) if min > max)
    {
        return Err(bad(
            "the starting salary cannot be higher than the top salary",
        ));
    }
    if let Some(raw) = &req.url {
        // An unchanged URL is not re-validated, so odd stored URLs stay editable.
        if raw.trim() != job.url {
            let url = posting_url(raw)?;
            job.canonical_key = key_for_new_url(&state, &job, &url).await?;
            job.url = url;
        }
    }

    let res = sqlx::query(
        r#"
        UPDATE jobs SET
            title = ?1, company = ?2, url = ?3, canonical_key = ?4, location = ?5,
            workplace_type = ?6, salary_min = ?7, salary_max = ?8, salary_currency = ?9,
            yoe_label = ?10, yoe_min = ?11, yoe_max = ?12, updated_at = ?13
        WHERE id = ?14
        "#,
    )
    .bind(&job.title)
    .bind(&job.company)
    .bind(&job.url)
    .bind(&job.canonical_key)
    .bind(&job.location)
    .bind(&job.workplace_type)
    .bind(job.salary_min)
    .bind(job.salary_max)
    .bind(&job.salary_currency)
    .bind(&job.yoe_label)
    .bind(job.yoe_min)
    .bind(job.yoe_max)
    .bind(now_iso())
    .bind(&id)
    .execute(&state.pool)
    .await;
    match res {
        Ok(done) if done.rows_affected() == 0 => Err(job_not_found(&id)),
        Ok(_) => Ok(Json(load_job(&state, &id).await?)),
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => Err(AppError::Conflict(
            "Another job already uses this URL".to_string(),
        )),
        Err(err) => Err(err.into()),
    }
}

#[utoipa::path(
    put,
    path = "/api/jobs/{id}/archive",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = ArchiveJobRequest,
    responses(
        (status = 200, description = "Archive or unarchive a job", body = JobRecord),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn set_job_archived(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ArchiveJobRequest>,
) -> Result<Json<JobRecord>, AppError> {
    // Archiving twice keeps the first date.
    let res = sqlx::query(
        "UPDATE jobs SET archived_at = CASE WHEN ?1 THEN COALESCE(archived_at, ?2) END, \
         updated_at = ?2 WHERE id = ?3",
    )
    .bind(req.archived)
    .bind(now_iso())
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(job_not_found(&id));
    }
    Ok(Json(load_job(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/jobs/{id}",
    params(("id" = String, Path, description = "Job UUID"), DeleteJobQuery),
    responses(
        (status = 200, description = "Delete a job and its related rows for good", body = DeleteJobResponse),
        (status = 400, description = "Missing confirm=true", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn delete_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteJobQuery>,
) -> Result<Json<DeleteJobResponse>, AppError> {
    if query.confirm != Some(true) {
        return Err(bad("deleting a job cannot be undone; pass confirm=true"));
    }
    // Foreign keys remove or unlink everything that points at the job.
    let res = sqlx::query("DELETE FROM jobs WHERE id = ?1")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(job_not_found(&id));
    }
    Ok(Json(DeleteJobResponse { deleted: id }))
}

async fn annotations(state: &AppState, job_id: &str) -> Result<Json<JobAnnotations>, AppError> {
    let notes = sqlx::query_as::<_, JobNote>(
        "SELECT id, body, created_at, updated_at FROM job_notes \
         WHERE job_id = ?1 ORDER BY created_at DESC, rowid DESC",
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await?;
    let tags = sqlx::query_scalar::<_, String>(
        "SELECT tag FROM job_tags WHERE job_id = ?1 ORDER BY lower(tag), tag",
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(JobAnnotations { notes, tags }))
}

#[utoipa::path(
    get,
    path = "/api/jobs/{id}/annotations",
    params(("id" = String, Path, description = "Job UUID")),
    responses(
        (status = 200, description = "Notes and tags for a job", body = JobAnnotations),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn get_annotations(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<JobAnnotations>, AppError> {
    require_job(&state, &id).await?;
    annotations(&state, &id).await
}

fn note_body(raw: &str) -> Result<String, AppError> {
    let body = raw.replace("\r\n", "\n").trim().to_string();
    if body.is_empty() {
        return Err(bad("a note cannot be empty"));
    }
    if body.chars().count() > MAX_NOTE_CHARS {
        return Err(bad(format!(
            "a note must be at most {MAX_NOTE_CHARS} characters"
        )));
    }
    Ok(body)
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/notes",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = NoteRequest,
    responses((status = 200, description = "Add a note", body = JobAnnotations)),
    tag = "jobs"
)]
pub async fn add_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<NoteRequest>,
) -> Result<Json<JobAnnotations>, AppError> {
    let body = note_body(&req.body)?;
    require_job(&state, &id).await?;
    sqlx::query(
        "INSERT INTO job_notes (id, job_id, body, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
    )
    .bind(new_id())
    .bind(&id)
    .bind(body)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;
    annotations(&state, &id).await
}

#[utoipa::path(
    patch,
    path = "/api/jobs/{id}/notes/{note_id}",
    params(
        ("id" = String, Path, description = "Job UUID"),
        ("note_id" = String, Path, description = "Note UUID")
    ),
    request_body = NoteRequest,
    responses(
        (status = 200, description = "Change a note", body = JobAnnotations),
        (status = 404, description = "Note not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn update_note(
    State(state): State<AppState>,
    Path((id, note_id)): Path<(String, String)>,
    Json(req): Json<NoteRequest>,
) -> Result<Json<JobAnnotations>, AppError> {
    let body = note_body(&req.body)?;
    let res = sqlx::query(
        "UPDATE job_notes SET body = ?1, updated_at = ?2 WHERE id = ?3 AND job_id = ?4",
    )
    .bind(body)
    .bind(now_iso())
    .bind(&note_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("note {note_id} not found")));
    }
    annotations(&state, &id).await
}

#[utoipa::path(
    delete,
    path = "/api/jobs/{id}/notes/{note_id}",
    params(
        ("id" = String, Path, description = "Job UUID"),
        ("note_id" = String, Path, description = "Note UUID")
    ),
    responses(
        (status = 200, description = "Delete a note", body = JobAnnotations),
        (status = 404, description = "Note not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn delete_note(
    State(state): State<AppState>,
    Path((id, note_id)): Path<(String, String)>,
) -> Result<Json<JobAnnotations>, AppError> {
    let res = sqlx::query("DELETE FROM job_notes WHERE id = ?1 AND job_id = ?2")
        .bind(&note_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("note {note_id} not found")));
    }
    annotations(&state, &id).await
}

/// Collapses inner whitespace so tags that look the same are the same.
fn tag_name(raw: &str) -> Result<String, AppError> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    required_line("tag", &collapsed, MAX_TAG_CHARS)
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/tags",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = TagRequest,
    responses(
        (status = 200, description = "Add a tag; a tag the job already has (ignoring case) is kept as it is", body = JobAnnotations)
    ),
    tag = "jobs"
)]
pub async fn add_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<TagRequest>,
) -> Result<Json<JobAnnotations>, AppError> {
    let tag = tag_name(&req.tag)?;
    require_job(&state, &id).await?;
    // One statement, so the duplicate check and the limit cannot be raced.
    let res = sqlx::query(
        "INSERT INTO job_tags (job_id, tag) SELECT ?1, ?2 \
         WHERE NOT EXISTS (SELECT 1 FROM job_tags WHERE job_id = ?1 AND tag = ?2 COLLATE NOCASE) \
           AND (SELECT COUNT(*) FROM job_tags WHERE job_id = ?1) < ?3",
    )
    .bind(&id)
    .bind(&tag)
    .bind(MAX_TAGS_PER_JOB)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM job_tags WHERE job_id = ?1 AND tag = ?2 COLLATE NOCASE",
        )
        .bind(&id)
        .bind(&tag)
        .fetch_one(&state.pool)
        .await?;
        if exists == 0 {
            return Err(bad(format!(
                "a job can have at most {MAX_TAGS_PER_JOB} tags"
            )));
        }
    }
    annotations(&state, &id).await
}

#[utoipa::path(
    patch,
    path = "/api/jobs/{id}/tags",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = RenameTagRequest,
    responses(
        (status = 200, description = "Rename a tag; renaming onto another tag merges them", body = JobAnnotations),
        (status = 404, description = "Tag not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn rename_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<RenameTagRequest>,
) -> Result<Json<JobAnnotations>, AppError> {
    let to = tag_name(&req.to)?;
    let mut tx = state.pool.begin().await?;
    let removed = sqlx::query("DELETE FROM job_tags WHERE job_id = ?1 AND tag = ?2")
        .bind(&id)
        .bind(&req.from)
        .execute(&mut *tx)
        .await?;
    if removed.rows_affected() == 0 {
        return Err(AppError::NotFound("tag not found on this job".to_string()));
    }
    sqlx::query(
        "INSERT INTO job_tags (job_id, tag) SELECT ?1, ?2 \
         WHERE NOT EXISTS (SELECT 1 FROM job_tags WHERE job_id = ?1 AND tag = ?2 COLLATE NOCASE)",
    )
    .bind(&id)
    .bind(&to)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    annotations(&state, &id).await
}

#[utoipa::path(
    delete,
    path = "/api/jobs/{id}/tags",
    params(("id" = String, Path, description = "Job UUID"), RemoveTagQuery),
    responses((status = 200, description = "Remove a tag", body = JobAnnotations)),
    tag = "jobs"
)]
pub async fn remove_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RemoveTagQuery>,
) -> Result<Json<JobAnnotations>, AppError> {
    require_job(&state, &id).await?;
    sqlx::query("DELETE FROM job_tags WHERE job_id = ?1 AND tag = ?2")
        .bind(&id)
        .bind(&query.tag)
        .execute(&state.pool)
        .await?;
    annotations(&state, &id).await
}

pub fn router() -> axum::Router<AppState> {
    use axum::routing::{get, patch, post, put};
    axum::Router::new()
        // `GET /api/jobs/{id}` lives in `routes::jobs`; axum merges the methods.
        .route("/api/jobs/{id}", patch(update_job).delete(delete_job))
        .route("/api/jobs/{id}/archive", put(set_job_archived))
        .route("/api/jobs/{id}/annotations", get(get_annotations))
        .route("/api/jobs/{id}/notes", post(add_note))
        .route(
            "/api/jobs/{id}/notes/{note_id}",
            patch(update_note).delete(delete_note),
        )
        .route(
            "/api/jobs/{id}/tags",
            post(add_tag).patch(rename_tag).delete(remove_tag),
        )
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(
    update_job,
    set_job_archived,
    delete_job,
    get_annotations,
    add_note,
    update_note,
    delete_note,
    add_tag,
    rename_tag,
    remove_tag
))]
pub struct Doc;

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::{
        ai::MockAiProvider, config::AppConfig, db::init_pool, integrations::scanner::ScannedJob,
    };

    async fn state() -> AppState {
        AppState::for_test(
            init_pool("sqlite::memory:").await.unwrap(),
            AppConfig::default(),
            Arc::new(MockAiProvider),
        )
    }

    fn scanned(url: &str, source_type: &str) -> ScannedJob {
        ScannedJob {
            canonical_key: canonicalize_url_key(url),
            url: url.into(),
            company: "Example Co".into(),
            title: "Platform Engineer".into(),
            location: Some("Remote".into()),
            workplace_type: Some("remote".into()),
            posted_at: None,
            source_type: source_type.into(),
            jd_text: Some("Run the platform.".into()),
        }
    }

    async fn add(state: &AppState, url: &str, source_type: &str) -> String {
        state
            .ingest_scanned_jobs(&[scanned(url, source_type)], None)
            .await
            .unwrap();
        sqlx::query_scalar("SELECT id FROM jobs WHERE url = ?1")
            .bind(url)
            .fetch_one(&state.pool)
            .await
            .unwrap()
    }

    async fn edit(
        state: &AppState,
        id: &str,
        body: serde_json::Value,
    ) -> Result<JobRecord, AppError> {
        update_job(
            State(state.clone()),
            Path(id.to_string()),
            Json(serde_json::from_value(body).unwrap()),
        )
        .await
        .map(|Json(job)| job)
    }

    async fn job_count(state: &AppState) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM jobs")
            .fetch_one(&state.pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn only_sent_fields_change_and_a_rescan_keeps_them() {
        let state = state().await;
        let url = "https://jobs.example.com/1";
        let id = add(&state, url, "ats_board").await;

        let job = edit(
            &state,
            &id,
            serde_json::json!({
                "title": "  Staff Platform Engineer ",
                "location": null,
                "salary_min": 150000,
                "salary_max": 180000,
                "salary_currency": "usd",
                "yoe_label": "5+ years"
            }),
        )
        .await
        .unwrap();
        assert_eq!(job.title, "Staff Platform Engineer");
        assert_eq!(job.company, "Example Co");
        assert_eq!(job.location, None);
        assert_eq!(job.workplace_type.as_deref(), Some("remote"));
        assert_eq!(job.salary_currency.as_deref(), Some("USD"));

        let outcome = state
            .ingest_scanned_jobs(&[scanned(url, "ats_board")], None)
            .await
            .unwrap();
        assert_eq!((outcome.ingested, outcome.duplicates), (0, 1));
        let after = load_job(&state, &id).await.unwrap();
        assert_eq!(after.title, "Staff Platform Engineer");
        assert_eq!(after.location, None);
        assert_eq!(after.salary_max, Some(180_000));
    }

    #[tokio::test]
    async fn bad_values_are_rejected() {
        let state = state().await;
        let id = add(&state, "https://jobs.example.com/1", "manual").await;
        for body in [
            serde_json::json!({"title": "  "}),
            serde_json::json!({"company": "two\nlines"}),
            serde_json::json!({"title": "x".repeat(301)}),
            serde_json::json!({"url": "javascript:alert(1)"}),
            serde_json::json!({"url": "ftp://example.com/job"}),
            serde_json::json!({"url": "https://"}),
            serde_json::json!({"url": "https://user:pw@example.com/job"}),
            serde_json::json!({"url": "https://example.com/a b"}),
            serde_json::json!({"workplace_type": "moon"}),
            serde_json::json!({"salary_min": -1}),
            serde_json::json!({"salary_min": 200, "salary_max": 100}),
            serde_json::json!({"salary_currency": "dollars"}),
        ] {
            let err = edit(&state, &id, body.clone()).await.unwrap_err();
            assert!(matches!(err, AppError::BadRequest(_)), "{body}: {err}");
        }
        let job = load_job(&state, &id).await.unwrap();
        assert_eq!(job.title, "Platform Engineer");
        assert_eq!(job.url, "https://jobs.example.com/1");
        assert!(matches!(
            edit(&state, "missing", serde_json::json!({})).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn changing_the_url_respects_the_dedupe_key() {
        let state = state().await;
        let scanned_id = add(&state, "https://jobs.example.com/scanned", "ats_board").await;
        let manual_id = add(&state, "https://jobs.example.com/manual", "manual").await;

        // Taken by another job, even when it differs only by tracking noise.
        let err = edit(
            &state,
            &manual_id,
            serde_json::json!({"url": "https://jobs.example.com/scanned/?utm_source=x"}),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err}");

        let manual = edit(
            &state,
            &manual_id,
            serde_json::json!({"url": "https://jobs.example.com/manual-2"}),
        )
        .await
        .unwrap();
        assert_eq!(manual.canonical_key, "https://jobs.example.com/manual-2");

        let moved = edit(
            &state,
            &scanned_id,
            serde_json::json!({"url": "https://jobs.example.com/new-home"}),
        )
        .await
        .unwrap();
        assert_eq!(moved.canonical_key, "https://jobs.example.com/scanned");
        // The next scan still recognizes the posting.
        state
            .ingest_scanned_jobs(
                &[scanned("https://jobs.example.com/scanned", "ats_board")],
                None,
            )
            .await
            .unwrap();
        assert_eq!(job_count(&state).await, 2);
        assert_eq!(
            load_job(&state, &scanned_id).await.unwrap().url,
            "https://jobs.example.com/new-home"
        );
        // The moved job's new URL is not free for another job, whatever its key says.
        let err = edit(
            &state,
            &manual_id,
            serde_json::json!({"url": "https://jobs.example.com/new-home"}),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err}");
    }

    #[tokio::test]
    async fn archive_toggles_and_keeps_the_first_date() {
        let state = state().await;
        let id = add(&state, "https://jobs.example.com/1", "manual").await;
        let set = |archived| {
            set_job_archived(
                State(state.clone()),
                Path(id.clone()),
                Json(ArchiveJobRequest { archived }),
            )
        };
        let first = set(true).await.unwrap().0.archived_at;
        assert!(first.is_some());
        assert_eq!(set(true).await.unwrap().0.archived_at, first);
        assert_eq!(set(false).await.unwrap().0.archived_at, None);
    }

    #[tokio::test]
    async fn delete_needs_confirmation_and_cascades() {
        let state = state().await;
        let id = add(&state, "https://jobs.example.com/1", "manual").await;
        let _ = add_note(
            State(state.clone()),
            Path(id.clone()),
            Json(NoteRequest {
                body: "Call back".into(),
            }),
        )
        .await
        .unwrap();
        state
            .record_job_event(&id, "triage", None, "shortlisted")
            .await
            .unwrap();
        sqlx::query("INSERT INTO applications (id, job_id) VALUES ('app-1', ?1)")
            .bind(&id)
            .execute(&state.pool)
            .await
            .unwrap();

        let delete = |confirm| {
            delete_job(
                State(state.clone()),
                Path(id.clone()),
                Query(DeleteJobQuery { confirm }),
            )
        };
        assert!(matches!(delete(None).await, Err(AppError::BadRequest(_))));
        assert_eq!(job_count(&state).await, 1);
        let _ = delete(Some(true)).await.unwrap();
        for table in ["jobs", "job_notes", "job_events", "applications"] {
            let left: i64 =
                sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
                    .fetch_one(&state.pool)
                    .await
                    .unwrap();
            assert_eq!(left, 0, "{table}");
        }
        assert!(matches!(
            delete(Some(true)).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn notes_and_tags_can_be_added_edited_and_removed() {
        let state = state().await;
        let id = add(&state, "https://jobs.example.com/1", "manual").await;
        let s = || State(state.clone());
        let p = || Path(id.clone());
        let tag = |t: &str| Json(TagRequest { tag: t.into() });
        let note = |b: &str| Json(NoteRequest { body: b.into() });

        let _ = add_tag(s(), p(), tag("  Dream   job ")).await.unwrap();
        let _ = add_tag(s(), p(), tag("dream job")).await.unwrap();
        let tags = add_tag(s(), p(), tag("referral")).await.unwrap().0.tags;
        assert_eq!(tags, ["Dream job", "referral"]);
        assert!(add_tag(s(), p(), tag("   ")).await.is_err());

        let rename = |from: &str, to: &str| {
            Json(RenameTagRequest {
                from: from.into(),
                to: to.into(),
            })
        };
        // Changing only the case works.
        let tags = rename_tag(s(), p(), rename("referral", "Referral"))
            .await
            .unwrap()
            .0
            .tags;
        assert_eq!(tags, ["Dream job", "Referral"]);
        // Renaming onto another tag merges them.
        let tags = rename_tag(s(), p(), rename("Referral", "dream job"))
            .await
            .unwrap()
            .0
            .tags;
        assert_eq!(tags, ["Dream job"]);
        assert!(rename_tag(s(), p(), rename("gone", "x")).await.is_err());
        let tags = remove_tag(
            s(),
            p(),
            Query(RemoveTagQuery {
                tag: "Dream job".into(),
            }),
        )
        .await
        .unwrap()
        .0
        .tags;
        assert!(tags.is_empty());

        for n in 0..MAX_TAGS_PER_JOB {
            let _ = add_tag(s(), p(), tag(&format!("t{n}"))).await.unwrap();
        }
        assert!(add_tag(s(), p(), tag("one too many")).await.is_err());
        assert!(add_tag(s(), p(), tag("T0")).await.is_ok());

        assert!(add_note(s(), p(), note(" \n ")).await.is_err());
        let added = add_note(s(), p(), note("First\r\nline two"))
            .await
            .unwrap()
            .0;
        assert_eq!(added.notes[0].body, "First\nline two");
        let note_id = added.notes[0].id.clone();
        let edited = update_note(s(), Path((id.clone(), note_id.clone())), note("Changed"))
            .await
            .unwrap()
            .0;
        assert_eq!(edited.notes[0].body, "Changed");
        // A note is only reachable through its own job.
        assert!(delete_note(s(), Path(("other".into(), note_id.clone())))
            .await
            .is_err());
        let left = delete_note(s(), Path((id.clone(), note_id)))
            .await
            .unwrap()
            .0;
        assert!(left.notes.is_empty());
        assert!(matches!(
            add_note(s(), Path("missing".into()), note("x")).await,
            Err(AppError::NotFound(_))
        ));
    }

    /// The new methods share a path with `GET /api/jobs/{id}`; neither side may
    /// replace the other in the router or the spec.
    #[test]
    fn job_path_keeps_every_method() {
        let _ = crate::routes::api_router();
        let spec = serde_json::to_value(crate::openapi::spec()).unwrap();
        for method in ["get", "patch", "delete"] {
            assert!(
                spec["paths"]["/api/jobs/{id}"][method].is_object(),
                "{method}"
            );
        }
    }
}
