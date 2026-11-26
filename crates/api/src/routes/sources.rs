use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct SourceRecord {
    pub id: String,
    pub company: String,
    pub provider: String,
    pub careers_url: String,
    pub board_id: Option<String>,
    pub enabled: bool,
    pub notes: Option<String>,
    pub last_scanned_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListSourcesResponse {
    pub sources: Vec<SourceRecord>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSourceRequest {
    pub company: String,
    pub provider: String,
    pub careers_url: String,
    pub board_id: Option<String>,
    pub enabled: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSourceRequest {
    pub company: Option<String>,
    pub provider: Option<String>,
    pub careers_url: Option<String>,
    pub board_id: Option<String>,
    pub enabled: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TriggerScanRequest {
    pub source_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TriggerScanResponse {
    pub sync_run_id: String,
    pub sources_scanned: usize,
    pub items_fetched: i64,
    pub items_ingested: i64,
    pub items_errored: i64,
}

#[utoipa::path(
    get,
    path = "/api/sources",
    responses(
        (status = 200, description = "List configured ATS/job sources", body = ListSourcesResponse)
    ),
    tag = "sources"
)]
pub async fn list_sources(
    State(state): State<AppState>,
) -> Result<Json<ListSourcesResponse>, AppError> {
    let sources = sqlx::query_as::<_, SourceRecord>(
        r#"
        SELECT id, company, provider, careers_url, board_id, enabled, notes,
               last_scanned_at, last_error, created_at
        FROM sources
        ORDER BY company ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListSourcesResponse { sources }))
}

#[utoipa::path(
    post,
    path = "/api/sources",
    request_body = CreateSourceRequest,
    responses(
        (status = 200, description = "Source created", body = SourceRecord)
    ),
    tag = "sources"
)]
pub async fn create_source(
    State(state): State<AppState>,
    Json(req): Json<CreateSourceRequest>,
) -> Result<Json<SourceRecord>, AppError> {
    let id = new_id();
    let now = now_iso();
    let enabled = req.enabled.unwrap_or(true);

    sqlx::query(
        r#"
        INSERT INTO sources (id, company, provider, careers_url, board_id, enabled, notes, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(&id)
    .bind(&req.company)
    .bind(&req.provider)
    .bind(&req.careers_url)
    .bind(&req.board_id)
    .bind(enabled)
    .bind(&req.notes)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    let created = sqlx::query_as::<_, SourceRecord>(
        r#"
        SELECT id, company, provider, careers_url, board_id, enabled, notes,
               last_scanned_at, last_error, created_at
        FROM sources WHERE id = ?1
        "#,
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(created))
}

#[utoipa::path(
    patch,
    path = "/api/sources/{id}",
    params(
        ("id" = String, Path, description = "Source UUID")
    ),
    request_body = UpdateSourceRequest,
    responses(
        (status = 200, description = "Source updated", body = SourceRecord),
        (status = 404, description = "Source not found", body = crate::error::ErrorResponse)
    ),
    tag = "sources"
)]
pub async fn update_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateSourceRequest>,
) -> Result<Json<SourceRecord>, AppError> {
    let res = sqlx::query(
        r#"
        UPDATE sources
        SET company = COALESCE(?1, company),
            provider = COALESCE(?2, provider),
            careers_url = COALESCE(?3, careers_url),
            board_id = COALESCE(?4, board_id),
            enabled = COALESCE(?5, enabled),
            notes = COALESCE(?6, notes)
        WHERE id = ?7
        "#,
    )
    .bind(&req.company)
    .bind(&req.provider)
    .bind(&req.careers_url)
    .bind(&req.board_id)
    .bind(req.enabled)
    .bind(&req.notes)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("source {id} not found")));
    }

    let updated = sqlx::query_as::<_, SourceRecord>(
        r#"
        SELECT id, company, provider, careers_url, board_id, enabled, notes,
               last_scanned_at, last_error, created_at
        FROM sources WHERE id = ?1
        "#,
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteSourceResponse {
    pub deleted: bool,
    pub id: String,
}

#[utoipa::path(
    delete,
    path = "/api/sources/{id}",
    params(
        ("id" = String, Path, description = "Source UUID")
    ),
    responses(
        (status = 200, description = "Source deleted", body = DeleteSourceResponse),
        (status = 404, description = "Source not found", body = crate::error::ErrorResponse)
    ),
    tag = "sources"
)]
pub async fn delete_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteSourceResponse>, AppError> {
    let res = sqlx::query("DELETE FROM sources WHERE id = ?1")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("source {id} not found")));
    }

    Ok(Json(DeleteSourceResponse { deleted: true, id }))
}

#[utoipa::path(
    post,
    path = "/api/sources/scan",
    request_body = TriggerScanRequest,
    responses(
        (status = 200, description = "ATS scan executed", body = TriggerScanResponse)
    ),
    tag = "sources"
)]
pub async fn trigger_scan(
    State(state): State<AppState>,
    Json(req): Json<TriggerScanRequest>,
) -> Result<Json<TriggerScanResponse>, AppError> {
    let outcome = run_ats_scan(&state, req.source_id.as_deref()).await?;
    Ok(Json(outcome))
}

pub async fn run_ats_scan(
    state: &AppState,
    only_source_id: Option<&str>,
) -> Result<TriggerScanResponse, AppError> {
    let sync_run_id = new_id();
    let started_at = now_iso();
    sqlx::query(
        "INSERT INTO sync_runs (id, run_type, status, started_at) VALUES (?1, 'ats_scan', 'running', ?2)",
    )
    .bind(&sync_run_id)
    .bind(&started_at)
    .execute(&state.pool)
    .await?;

    let sources = sqlx::query_as::<_, SourceRecord>(
        r#"
        SELECT id, company, provider, careers_url, board_id, enabled, notes,
               last_scanned_at, last_error, created_at
        FROM sources
        WHERE enabled = 1 AND (?1 IS NULL OR id = ?1)
        "#,
    )
    .bind(only_source_id)
    .fetch_all(&state.pool)
    .await?;

    let mut items_fetched = 0_i64;
    let mut items_ingested = 0_i64;
    let mut items_errored = 0_i64;

    for src in &sources {
        let Some(board_id) = src.board_id.as_deref() else {
            continue;
        };
        let scan_now = now_iso();
        match state
            .scanner
            .scan_ats_board(&src.provider, &src.company, board_id)
            .await
        {
            Ok(jobs) => {
                items_fetched += jobs.len() as i64;
                let ingest = state.ingest_scanned_jobs(&jobs, Some(&src.id)).await?;
                items_ingested += ingest.ingested;
                sqlx::query(
                    "UPDATE sources SET last_scanned_at = ?1, last_error = NULL WHERE id = ?2",
                )
                .bind(&scan_now)
                .bind(&src.id)
                .execute(&state.pool)
                .await?;
            }
            Err(err) => {
                items_errored += 1;
                sqlx::query(
                    "UPDATE sources SET last_scanned_at = ?1, last_error = ?2 WHERE id = ?3",
                )
                .bind(&scan_now)
                .bind(err.to_string())
                .bind(&src.id)
                .execute(&state.pool)
                .await?;
            }
        }
    }

    let status = if items_errored == 0 {
        "succeeded"
    } else if items_ingested > 0 {
        "partial"
    } else {
        "failed"
    };

    sqlx::query(
        r#"
        UPDATE sync_runs
        SET status = ?1, items_fetched = ?2, items_ingested = ?3, items_errored = ?4, finished_at = ?5
        WHERE id = ?6
        "#,
    )
    .bind(status)
    .bind(items_fetched)
    .bind(items_ingested)
    .bind(items_errored)
    .bind(now_iso())
    .bind(&sync_run_id)
    .execute(&state.pool)
    .await?;

    Ok(TriggerScanResponse {
        sync_run_id,
        sources_scanned: sources.len(),
        items_fetched,
        items_ingested,
        items_errored,
    })
}
