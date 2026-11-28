//! Filling job descriptions: on demand, in bulk, or pasted by the user.
//! All text passes through the scanner sidecar's posting guard before storage.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    db::now_iso,
    error::AppError,
    integrations::scanner::{
        fetch_postings_via_sidecar, sanitize_via_sidecar, PostingRequest, PostingResult,
        MAX_POSTINGS_PER_REQUEST,
    },
    state::AppState,
};

const MAX_PASTED_BYTES: usize = 200_000;

#[derive(Debug, Serialize, ToSchema)]
pub struct FetchDescriptionResponse {
    /// `ok` | `gone` | `empty` | `unsupported` | `error`
    pub status: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetDescriptionRequest {
    pub text: String,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct BackfillRequest {
    /// Also queue jobs the AI skipped while they had no description.
    #[serde(default)]
    pub rescore_ai_skipped: bool,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct BackfillResponse {
    pub checked: usize,
    pub filled: usize,
    /// Already complete: the job board's text is no longer than the saved one.
    pub unchanged: usize,
    /// The employer no longer lists the posting.
    pub gone: usize,
    /// The site is not a supported job board, or lists no description.
    pub unavailable: usize,
    pub failed: usize,
    /// Jobs the AI skipped without a description that now have one.
    pub ai_skipped_without_description: i64,
    pub requeued_ai_skipped: u64,
}

#[derive(Debug, FromRow)]
struct MissingRow {
    id: String,
    url: String,
    /// Length of a saved description that may have been cut off, else 0.
    truncated_len: i64,
    provider: Option<String>,
    board_id: Option<String>,
    careers_url: Option<String>,
}

/// Job rows joined to their source (by id, else by company name) so
/// company-hosted posting pages can be resolved to a board.
const JOB_WITH_BOARD: &str = r#"
    SELECT j.id, j.url,
           CASE WHEN LENGTH(j.jd_text) BETWEEN 3900 AND 4000 THEN LENGTH(j.jd_text) ELSE 0 END
               AS truncated_len,
           s.provider, s.board_id, s.careers_url
    FROM jobs j
    LEFT JOIN sources s ON s.id = COALESCE(
        j.source_id,
        (SELECT id FROM sources WHERE lower(company) = lower(j.company) LIMIT 1)
    )
"#;

impl MissingRow {
    fn request(&self) -> PostingRequest {
        let board = self
            .board_id
            .clone()
            .filter(|b| !b.trim().is_empty())
            .or_else(|| {
                let url = self.careers_url.as_deref()?;
                let path = url.split(['?', '#']).next()?.trim_end_matches('/');
                path.rsplit('/').next().map(str::to_string)
            });
        PostingRequest {
            url: self.url.clone(),
            board_provider: self.provider.clone(),
            board,
        }
    }
}

fn scanner_url(state: &AppState) -> Result<&str, AppError> {
    state.config.scanner_url.as_deref().ok_or_else(|| {
        AppError::ServiceUnavailable(
            "SCANNER_URL is not set; descriptions need the scanner sidecar".into(),
        )
    })
}

async fn fetch_batch(
    state: &AppState,
    rows: &[MissingRow],
) -> Result<Vec<PostingResult>, AppError> {
    let items: Vec<PostingRequest> = rows.iter().map(MissingRow::request).collect();
    fetch_postings_via_sidecar(state.scanner.http(), scanner_url(state)?, &items).await
}

/// Fetches and stores one job's description. Returns the fetch status.
pub async fn fetch_description_for(state: &AppState, job_id: &str) -> Result<String, AppError> {
    let row = sqlx::query_as::<_, MissingRow>(sqlx::AssertSqlSafe(format!(
        "{JOB_WITH_BOARD} WHERE j.id = ?1"
    )))
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;
    let result = fetch_batch(state, std::slice::from_ref(&row))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Upstream("scanner sidecar returned no result".into()))?;
    if let Some(text) = result.description() {
        state.save_description(&row.id, text).await?;
    }
    Ok(result.status)
}

#[utoipa::path(
    post,
    path = "/api/jobs/{id}/fetch-description",
    params(("id" = String, Path, description = "Job UUID")),
    responses(
        (status = 200, description = "Fetch result; the description is saved when status is `ok`", body = FetchDescriptionResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 503, description = "Scanner not configured", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn fetch_description(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<FetchDescriptionResponse>, AppError> {
    let status = fetch_description_for(&state, &id).await?;
    Ok(Json(FetchDescriptionResponse { status }))
}

#[utoipa::path(
    put,
    path = "/api/jobs/{id}/description",
    params(("id" = String, Path, description = "Job UUID")),
    request_body = SetDescriptionRequest,
    responses(
        (status = 200, description = "Pasted description sanitized and saved", body = FetchDescriptionResponse),
        (status = 400, description = "Empty or oversized text", body = crate::error::ErrorResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse),
        (status = 503, description = "Scanner not configured", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn set_description(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SetDescriptionRequest>,
) -> Result<Json<FetchDescriptionResponse>, AppError> {
    if req.text.trim().is_empty() || req.text.len() > MAX_PASTED_BYTES {
        return Err(AppError::BadRequest(
            "description must be between 1 and 200,000 bytes".into(),
        ));
    }
    let clean = sanitize_via_sidecar(state.scanner.http(), scanner_url(&state)?, &req.text)
        .await?
        .ok_or_else(|| AppError::BadRequest("description has no readable text".into()))?;
    if !state.save_description(&id, &clean).await? {
        return Err(AppError::NotFound(format!("job {id} not found")));
    }
    Ok(Json(FetchDescriptionResponse {
        status: "ok".into(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/jobs/backfill-descriptions",
    request_body = BackfillRequest,
    responses(
        (status = 200, description = "Fetch every missing description", body = BackfillResponse),
        (status = 503, description = "Scanner not configured", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn backfill_descriptions(
    State(state): State<AppState>,
    Json(req): Json<BackfillRequest>,
) -> Result<Json<BackfillResponse>, AppError> {
    scanner_url(&state)?;
    let rows = sqlx::query_as::<_, MissingRow>(sqlx::AssertSqlSafe(format!(
        "{JOB_WITH_BOARD} WHERE (COALESCE(TRIM(j.jd_text), '') = '' OR LENGTH(j.jd_text) BETWEEN 3900 AND 4000) \
         AND j.triage_status != 'blacklisted'"
    )))
    .fetch_all(&state.pool)
    .await?;

    let mut out = BackfillResponse {
        checked: rows.len(),
        ..Default::default()
    };
    for chunk in rows.chunks(MAX_POSTINGS_PER_REQUEST) {
        let results = match fetch_batch(&state, chunk).await {
            Ok(results) => results,
            Err(err) => {
                tracing::warn!(error = %err, "description backfill batch failed");
                out.failed += chunk.len();
                continue;
            }
        };
        // The sidecar answers in request order.
        out.failed += chunk.len().saturating_sub(results.len());
        for (row, result) in chunk.iter().zip(results) {
            if let Some(text) = result.description() {
                if row.truncated_len == 0 {
                    state.save_description(&row.id, text).await?;
                    out.filled += 1;
                } else if text.chars().count() as i64 > row.truncated_len {
                    state.extend_description(&row.id, text).await?;
                    out.filled += 1;
                } else {
                    out.unchanged += 1;
                }
            } else {
                match result.status.as_str() {
                    "gone" => out.gone += 1,
                    "empty" | "unsupported" => out.unavailable += 1,
                    _ => out.failed += 1,
                }
            }
        }
    }

    const AI_SKIPPED_STALE: &str = r#"
        triage_status = 'skipped'
        AND json_valid(tier1_json)
        AND json_extract(tier1_json, '$.recommended_status') = 'skipped'
        AND json_extract(tier1_json, '$.scored_without_description') = 1
        AND id NOT IN (SELECT job_id FROM applications)
    "#;
    out.ai_skipped_without_description = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM jobs WHERE {AI_SKIPPED_STALE}"
    )))
    .fetch_one(&state.pool)
    .await?;
    if req.rescore_ai_skipped {
        out.requeued_ai_skipped = sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE jobs SET triage_status = 'pending_scoring', tier1_score = NULL, tier1_json = NULL, updated_at = ?1 WHERE {AI_SKIPPED_STALE}"
        )))
        .bind(now_iso())
        .execute(&state.pool)
        .await?
        .rows_affected();
    }
    Ok(Json(out))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/api/jobs/backfill-descriptions",
            axum::routing::post(backfill_descriptions),
        )
        .route(
            "/api/jobs/{id}/fetch-description",
            axum::routing::post(fetch_description),
        )
        .route(
            "/api/jobs/{id}/description",
            axum::routing::put(set_description),
        )
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(backfill_descriptions, fetch_description, set_description))]
pub struct Doc;

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{routing::post, Router};
    use serde_json::{json, Value};
    use tokio::net::TcpListener;

    use super::*;
    use crate::{
        ai::MockAiProvider,
        config::AppConfig,
        db::init_pool,
        integrations::{
            calendar::CalendarClient,
            drive::DriveClient,
            gmail::GmailClient,
            maps::MapsClient,
            scanner::{ScannedJob, ScannerClient},
        },
    };

    /// Fills URLs ending in `/ok`, reports every other posting as gone.
    async fn fake_sidecar() -> String {
        let app = Router::new().route(
            "/fetch/postings",
            post(|Json(body): Json<Value>| async move {
                let results: Vec<Value> = body["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| {
                        if item["url"].as_str().unwrap().ends_with("/ok") {
                            json!({ "status": "ok", "jdText": "Run Kubernetes." })
                        } else {
                            json!({ "status": "gone" })
                        }
                    })
                    .collect();
                Json(json!({ "results": results }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn state_with_sidecar(url: String) -> AppState {
        AppState {
            pool: init_pool("sqlite::memory:").await.unwrap(),
            config: Arc::new(AppConfig {
                scheduler_enabled: false,
                scanner_url: Some(url),
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

    async fn insert(state: &AppState, id: &str, url: &str, status: &str, tier1: Option<&str>) {
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type, triage_status, tier1_score, tier1_json) \
             VALUES (?1, ?2, ?2, 'Example Co', 'Platform Engineer', 'manual', ?3, 40, ?4)",
        )
        .bind(id)
        .bind(url)
        .bind(status)
        .bind(tier1)
        .execute(&state.pool)
        .await
        .unwrap();
    }

    async fn status_of(state: &AppState, id: &str) -> (String, Option<String>) {
        sqlx::query_as("SELECT triage_status, jd_text FROM jobs WHERE id = ?1")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn backfill_requeues_waiting_jobs_and_only_reports_skipped_ones_until_asked() {
        let state = state_with_sidecar(fake_sidecar().await).await;
        let ai_skip = r#"{"recommended_status":"skipped"}"#;
        let ai_keep = r#"{"recommended_status":"pending_triage"}"#;
        insert(
            &state,
            "waiting",
            "https://a.example/ok",
            "pending_triage",
            Some(ai_keep),
        )
        .await;
        insert(
            &state,
            "ai-skip",
            "https://b.example/ok",
            "skipped",
            Some(ai_skip),
        )
        .await;
        insert(
            &state,
            "user-skip",
            "https://c.example/ok",
            "skipped",
            Some(ai_keep),
        )
        .await;
        insert(
            &state,
            "closed",
            "https://d.example/closed",
            "pending_triage",
            None,
        )
        .await;

        let Json(first) =
            backfill_descriptions(State(state.clone()), Json(BackfillRequest::default()))
                .await
                .unwrap();
        assert_eq!((first.checked, first.filled, first.gone), (4, 3, 1));
        assert_eq!(first.ai_skipped_without_description, 1);
        assert_eq!(first.requeued_ai_skipped, 0);
        assert_eq!(status_of(&state, "waiting").await.0, "pending_scoring");
        assert_eq!(status_of(&state, "ai-skip").await.0, "skipped");
        assert_eq!(
            status_of(&state, "closed").await,
            ("pending_triage".into(), None)
        );

        let Json(second) = backfill_descriptions(
            State(state.clone()),
            Json(BackfillRequest {
                rescore_ai_skipped: true,
            }),
        )
        .await
        .unwrap();
        assert_eq!(second.requeued_ai_skipped, 1);
        assert_eq!(status_of(&state, "ai-skip").await.0, "pending_scoring");
        assert_eq!(status_of(&state, "user-skip").await.0, "skipped");
    }

    #[tokio::test]
    async fn rescanned_posting_fills_an_empty_description_but_never_replaces_one() {
        let state = state_with_sidecar("http://127.0.0.1:1".into()).await;
        let mut job = ScannedJob {
            canonical_key: "k1".into(),
            url: "https://example.com/jobs/1".into(),
            company: "Example Co".into(),
            title: "Platform Engineer".into(),
            location: None,
            workplace_type: None,
            posted_at: None,
            source_type: "ats_board".into(),
            jd_text: None,
        };
        let ids = || async {
            sqlx::query_scalar::<_, String>("SELECT id FROM jobs")
                .fetch_one(&state.pool)
                .await
                .unwrap()
        };
        state
            .ingest_scanned_jobs(std::slice::from_ref(&job), None)
            .await
            .unwrap();
        job.jd_text = Some("First text".into());
        let outcome = state
            .ingest_scanned_jobs(std::slice::from_ref(&job), None)
            .await
            .unwrap();
        assert_eq!((outcome.ingested, outcome.duplicates), (0, 1));
        job.jd_text = Some("Second text".into());
        state
            .ingest_scanned_jobs(std::slice::from_ref(&job), None)
            .await
            .unwrap();
        assert_eq!(
            status_of(&state, &ids().await).await.1.as_deref(),
            Some("First text")
        );
    }
}
