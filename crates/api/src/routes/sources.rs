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
    integrations::scanner::{canonicalize_url_key, scan_via_sidecar, ScannedJob, SidecarSource},
    state::AppState,
};

/// Postings older than this are dropped by the scanner (same as the old
/// career-ops `max_posting_age_days`).
const MAX_POSTING_AGE_DAYS: u32 = 45;

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
    /// Jobs ingested from this source (only filled by `GET /api/sources`).
    #[sqlx(default)]
    pub matched_count: i64,
}

/// A posting the scanner's filters rejected.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct FilteredAuditRecord {
    pub id: String,
    pub url: String,
    pub company: String,
    pub title: String,
    pub location: Option<String>,
    pub reason_code: String,
    pub reason_detail: Option<String>,
    pub source_type: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListSourcesResponse {
    pub sources: Vec<SourceRecord>,
    /// Most recent 100 postings rejected by the scanner's filters.
    pub filtered_audit: Vec<FilteredAuditRecord>,
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
    /// Postings the scanner's filters rejected (see `filtered_audit`).
    pub items_filtered: i64,
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
        SELECT s.id, s.company, s.provider, s.careers_url, s.board_id, s.enabled, s.notes,
               s.last_scanned_at, s.last_error, s.created_at,
               (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id) AS matched_count
        FROM sources s
        ORDER BY s.company ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let filtered_audit = sqlx::query_as::<_, FilteredAuditRecord>(
        r#"
        SELECT id, url, company, title, location, reason_code, reason_detail, source_type, created_at
        FROM filtered_audit
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListSourcesResponse {
        sources,
        filtered_audit,
    }))
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

    let Some(sidecar_url) = state.config.scanner_url.as_deref() else {
        let msg = "SCANNER_URL is not set; ATS scans need the scanner sidecar's filters";
        sqlx::query(
            "UPDATE sync_runs SET status = 'failed', error_message = ?1, finished_at = ?2 WHERE id = ?3",
        )
        .bind(msg)
        .bind(now_iso())
        .bind(&sync_run_id)
        .execute(&state.pool)
        .await?;
        return Err(AppError::ServiceUnavailable(msg.into()));
    };
    let (items_fetched, items_ingested, items_filtered, items_errored) =
        scan_sources_filtered(state, &sources, sidecar_url).await?;

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
        SET status = ?1, items_fetched = ?2, items_ingested = ?3, items_errored = ?4, finished_at = ?5,
            items_filtered = ?7
        WHERE id = ?6
        "#,
    )
    .bind(status)
    .bind(items_fetched)
    .bind(items_ingested)
    .bind(items_errored)
    .bind(now_iso())
    .bind(&sync_run_id)
    .bind(items_filtered)
    .execute(&state.pool)
    .await?;

    Ok(TriggerScanResponse {
        sync_run_id,
        sources_scanned: sources.len(),
        items_fetched,
        items_ingested,
        items_filtered,
        items_errored,
    })
}

/// Scans all given sources through the scanner sidecar in one request.
/// Accepted postings are ingested; rejected ones are recorded in
/// `filtered_audit` with the filter's reason; per-source fetch errors are
/// stored on the source. Returns (fetched, ingested, filtered, errored).
async fn scan_sources_filtered(
    state: &AppState,
    sources: &[SourceRecord],
    sidecar_url: &str,
) -> Result<(i64, i64, i64, i64), AppError> {
    let entries: Vec<SidecarSource> = sources
        .iter()
        .map(|s| SidecarSource::new(&s.company, &s.careers_url, &s.provider))
        .collect();
    let profile = crate::profile::load_profile(&state.config.data_dir);
    let portals_config = profile.to_portals_config(MAX_POSTING_AGE_DAYS);
    let result =
        scan_via_sidecar(state.scanner.http(), sidecar_url, &entries, portals_config).await?;

    let by_company: std::collections::HashMap<String, &SourceRecord> = sources
        .iter()
        .map(|s| (s.company.to_lowercase(), s))
        .collect();
    let fetched = (result.accepted.len() + result.rejected.len()) as i64;
    let filtered = result.rejected.len() as i64;
    let errored = result.errors.len() as i64;

    // Ingest per source so jobs keep their source_id.
    let mut grouped: std::collections::HashMap<Option<String>, Vec<ScannedJob>> =
        Default::default();
    for job in result.accepted {
        let src = by_company
            .get(&job.company.to_lowercase())
            .map(|s| s.id.clone());
        grouped.entry(src).or_default().push(job.into_scanned());
    }
    let mut ingested = 0_i64;
    for (source_id, jobs) in &grouped {
        ingested += state
            .ingest_scanned_jobs(jobs, source_id.as_deref())
            .await?
            .ingested;
    }

    for r in &result.rejected {
        sqlx::query(
            r#"
            INSERT INTO filtered_audit (id, canonical_key, url, company, title, location, reason_code, reason_detail, source_type)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(new_id())
        .bind(canonicalize_url_key(&r.url))
        .bind(&r.url)
        .bind(&r.company)
        .bind(&r.title)
        .bind(&r.location)
        .bind(&r.reason_code)
        .bind(&r.reason_detail)
        .bind(r.db_source_type())
        .execute(&state.pool)
        .await?;
    }

    let now = now_iso();
    let errors: std::collections::HashMap<String, String> = result
        .errors
        .into_iter()
        .map(|e| (e.target.to_lowercase(), e.error))
        .collect();
    for src in sources {
        sqlx::query("UPDATE sources SET last_scanned_at = ?1, last_error = ?2 WHERE id = ?3")
            .bind(&now)
            .bind(errors.get(&src.company.to_lowercase()))
            .bind(&src.id)
            .execute(&state.pool)
            .await?;
    }
    Ok((fetched, ingested, filtered, errored))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/api/sources",
            axum::routing::get(list_sources).post(create_source),
        )
        .route(
            "/api/sources/{id}",
            axum::routing::patch(update_source).delete(delete_source),
        )
        .route("/api/sources/scan", axum::routing::post(trigger_scan))
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(
    list_sources,
    create_source,
    update_source,
    delete_source,
    trigger_scan
))]
pub struct Doc;

#[cfg(test)]
mod sidecar_tests {
    use std::sync::{Arc, Mutex};

    use axum::{routing::post, Router};
    use tokio::net::TcpListener;

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

    async fn fake_sidecar() -> (String, Arc<Mutex<Option<serde_json::Value>>>) {
        let seen: Arc<Mutex<Option<serde_json::Value>>> = Arc::default();
        let log = seen.clone();
        let app = Router::new().route(
            "/scan/ats",
            post(move |Json(body): Json<serde_json::Value>| {
                let log = log.clone();
                async move {
                    *log.lock().unwrap() = Some(body);
                    Json(serde_json::json!({
                        "accepted": [{
                            "canonicalKey": "x", "url": "https://jobs.example.com/acme/1",
                            "company": "Acme", "title": "Senior Platform Engineer",
                            "location": "Remote, US", "workplaceType": "remote",
                            "postedAt": "2026-11-20T00:00:00Z", "sourceType": "ats_board",
                            "jdText": "Run the platform."
                        }],
                        "rejected": [{
                            "canonicalKey": "y", "url": "https://jobs.example.com/acme/2",
                            "company": "Acme", "title": "Account Executive", "location": "Remote, US",
                            "reasonCode": "TITLE_NOT_TARGET", "reasonDetail": "not a target title",
                            "sourceType": "ats_board"
                        }],
                        "errors": [{ "target": "Globex", "error": "HTTP 404" }]
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}"), seen)
    }

    async fn state(scanner_url: Option<String>) -> AppState {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            "INSERT INTO sources (id, company, provider, careers_url, board_id, enabled) VALUES
             ('s1','Acme','greenhouse','https://job-boards.greenhouse.io/acme','acme',1),
             ('s2','Globex','auto','https://recruiting.paylocity.com/x',NULL,1),
             ('s3','Off','lever','https://jobs.lever.co/off','off',0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        AppState {
            pool,
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                scanner_url,
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

    #[tokio::test]
    async fn scan_goes_through_sidecar_filters() {
        let (url, seen) = fake_sidecar().await;
        let st = state(Some(url)).await;
        let out = run_ats_scan(&st, None).await.unwrap();
        assert_eq!(out.sources_scanned, 2); // disabled source not sent
        assert_eq!(
            (
                out.items_fetched,
                out.items_ingested,
                out.items_filtered,
                out.items_errored
            ),
            (2, 1, 1, 1)
        );

        let body = seen.lock().unwrap().clone().unwrap();
        assert_eq!(body["portalsConfig"]["max_posting_age_days"], 45);
        assert_eq!(body["sources"][0]["provider"], "greenhouse");
        // Unknown provider names are left for the sidecar to auto-detect.
        assert!(body["sources"][1].get("provider").is_none());

        let (title, source_id, src_type): (String, Option<String>, String) =
            sqlx::query_as("SELECT title, source_id, source_type FROM jobs")
                .fetch_one(&st.pool)
                .await
                .unwrap();
        assert_eq!(title, "Senior Platform Engineer");
        assert_eq!(source_id.as_deref(), Some("s1"));
        assert_eq!(src_type, "ats_board");
        let reason: String = sqlx::query_scalar("SELECT reason_code FROM filtered_audit")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(reason, "TITLE_NOT_TARGET");
        let errs: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id, last_error FROM sources WHERE enabled = 1 ORDER BY id")
                .fetch_all(&st.pool)
                .await
                .unwrap();
        assert_eq!(
            errs,
            vec![("s1".into(), None), ("s2".into(), Some("HTTP 404".into()))]
        );
        let status: String = sqlx::query_scalar("SELECT status FROM sync_runs")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(status, "partial");

        let list = list_sources(State(st.clone())).await.unwrap().0;
        let acme = list.sources.iter().find(|s| s.id == "s1").unwrap();
        assert_eq!(acme.matched_count, 1);
        assert_eq!(list.filtered_audit.len(), 1);
        assert_eq!(list.filtered_audit[0].title, "Account Executive");
    }

    #[tokio::test]
    async fn scan_without_sidecar_refuses_instead_of_ingesting_unfiltered() {
        let st = state(None).await;
        let err = run_ats_scan(&st, None).await.unwrap_err();
        assert_eq!(err.status_and_code().1, "SERVICE_UNAVAILABLE");
        let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(jobs, 0);
    }

    #[tokio::test]
    async fn scan_forwards_profile_scanner_filters_to_sidecar() {
        let dir = std::env::temp_dir().join(format!("sources-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("profile")).unwrap();
        std::fs::write(
            dir.join("profile/targeting.yml"),
            "schema_version: 1\nstatus: verified\nscanner_filters:\n  max_yoe: 3\n  max_posting_age_days: 30\n  excluded_domains:\n    - \"Aerospace\"\n",
        )
        .unwrap();

        let (url, seen) = fake_sidecar().await;
        let mut st = state(Some(url)).await;
        st.config = Arc::new(AppConfig {
            scheduler_enabled: false,
            scanner_url: st.config.scanner_url.clone(),
            data_dir: dir.clone(),
            ..AppConfig::default()
        });

        let _ = run_ats_scan(&st, None).await.unwrap();
        let body = seen.lock().unwrap().clone().unwrap();
        assert_eq!(body["portalsConfig"]["max_posting_age_days"], 30);
        assert_eq!(body["portalsConfig"]["scanner_filters"]["max_yoe"], 3);
        assert_eq!(
            body["portalsConfig"]["scanner_filters"]["excluded_domains"][0],
            "Aerospace"
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
