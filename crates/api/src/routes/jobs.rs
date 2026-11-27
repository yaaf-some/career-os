use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};

use crate::{
    error::AppError,
    integrations::scanner::{canonicalize_url_key, ScannedJob},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct JobRecord {
    pub id: String,
    pub canonical_key: String,
    pub url: String,
    pub company: String,
    pub title: String,
    pub location: Option<String>,
    pub workplace_type: Option<String>,
    pub yoe_min: Option<i64>,
    pub yoe_max: Option<i64>,
    pub yoe_label: Option<String>,
    pub salary_min: Option<i64>,
    pub salary_max: Option<i64>,
    pub salary_currency: Option<String>,
    pub posted_at: Option<String>,
    pub source_type: String,
    pub source_id: Option<String>,
    pub jd_text: Option<String>,
    pub guard_flags_json: Option<String>,
    pub triage_status: String,
    pub tier1_score: Option<f64>,
    pub tier1_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct EvaluationRecord {
    pub id: String,
    pub job_id: String,
    pub tier: String,
    pub model: String,
    /// CLI that produced it (`claude` | `agy`); null for rows before migration 0003.
    pub provider: Option<String>,
    pub overall_score: Option<f64>,
    pub archetype: Option<String>,
    pub blocks_json: Option<String>,
    pub report_md: Option<String>,
    pub rubric_score: Option<f64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct ApplicationRecord {
    pub id: String,
    pub job_id: String,
    pub stage: String,
    pub applied_at: Option<String>,
    pub next_followup_at: Option<String>,
    pub followup_count: i64,
    pub notes: Option<String>,
    pub gmail_thread_id: Option<String>,
    pub linear_issue_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct DriveArtifactRecord {
    pub id: String,
    pub job_id: String,
    pub kind: String,
    pub drive_file_id: String,
    pub drive_url: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListJobsQuery {
    pub triage_status: Option<String>,
    pub source_type: Option<String>,
    pub min_score: Option<f64>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListJobsResponse {
    pub jobs: Vec<JobRecord>,
    pub total: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct JobDetailResponse {
    pub job: JobRecord,
    pub evaluations: Vec<EvaluationRecord>,
    pub application: Option<ApplicationRecord>,
    pub drive_artifacts: Vec<DriveArtifactRecord>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct IngestJobInput {
    pub url: String,
    pub company: String,
    pub title: String,
    pub location: Option<String>,
    pub workplace_type: Option<String>,
    pub posted_at: Option<String>,
    pub source_type: Option<String>,
    pub jd_text: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct IngestJobsRequest {
    pub jobs: Vec<IngestJobInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IngestJobsResponse {
    pub ingested: i64,
    pub duplicates: i64,
}

#[utoipa::path(
    get,
    path = "/api/jobs",
    params(ListJobsQuery),
    responses(
        (status = 200, description = "List jobs with optional filters", body = ListJobsResponse)
    ),
    tag = "jobs"
)]
pub async fn list_jobs(
    State(state): State<AppState>,
    Query(query): Query<ListJobsQuery>,
) -> Result<Json<ListJobsResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let search_pattern = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_ascii_lowercase()));

    let total = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM jobs
        WHERE (?1 IS NULL OR triage_status = ?1)
          AND (?2 IS NULL OR source_type = ?2)
          AND (?3 IS NULL OR tier1_score >= ?3)
          AND (?4 IS NULL OR lower(title) LIKE ?4 OR lower(company) LIKE ?4)
        "#,
    )
    .bind(&query.triage_status)
    .bind(&query.source_type)
    .bind(query.min_score)
    .bind(&search_pattern)
    .fetch_one(&state.pool)
    .await?;

    let jobs = sqlx::query_as::<_, JobRecord>(
        r#"
        SELECT id, canonical_key, url, company, title, location, workplace_type,
               yoe_min, yoe_max, yoe_label, salary_min, salary_max, salary_currency,
               posted_at, source_type, source_id, jd_text, guard_flags_json,
               triage_status, tier1_score, tier1_json, created_at, updated_at
        FROM jobs
        WHERE (?1 IS NULL OR triage_status = ?1)
          AND (?2 IS NULL OR source_type = ?2)
          AND (?3 IS NULL OR tier1_score >= ?3)
          AND (?4 IS NULL OR lower(title) LIKE ?4 OR lower(company) LIKE ?4)
        ORDER BY COALESCE(tier1_score, -1.0) DESC, created_at DESC
        LIMIT ?5 OFFSET ?6
        "#,
    )
    .bind(&query.triage_status)
    .bind(&query.source_type)
    .bind(query.min_score)
    .bind(&search_pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListJobsResponse { jobs, total }))
}

#[utoipa::path(
    get,
    path = "/api/jobs/{id}",
    params(
        ("id" = String, Path, description = "Job UUID")
    ),
    responses(
        (status = 200, description = "Job detail with evaluations and application", body = JobDetailResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<JobDetailResponse>, AppError> {
    let job = sqlx::query_as::<_, JobRecord>(
        r#"
        SELECT id, canonical_key, url, company, title, location, workplace_type,
               yoe_min, yoe_max, yoe_label, salary_min, salary_max, salary_currency,
               posted_at, source_type, source_id, jd_text, guard_flags_json,
               triage_status, tier1_score, tier1_json, created_at, updated_at
        FROM jobs
        WHERE id = ?1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {id} not found")))?;

    let evaluations = sqlx::query_as::<_, EvaluationRecord>(
        r#"
        SELECT id, job_id, tier, model, provider, overall_score, archetype, blocks_json,
               report_md, rubric_score, created_at
        FROM evaluations
        WHERE job_id = ?1
        ORDER BY created_at DESC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let application = sqlx::query_as::<_, ApplicationRecord>(
        r#"
        SELECT id, job_id, stage, applied_at, next_followup_at, followup_count,
               notes, gmail_thread_id, linear_issue_id, updated_at
        FROM applications
        WHERE job_id = ?1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let drive_artifacts = sqlx::query_as::<_, DriveArtifactRecord>(
        r#"
        SELECT id, job_id, kind, drive_file_id, drive_url, title, created_at
        FROM drive_artifacts
        WHERE job_id = ?1
        ORDER BY created_at DESC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(JobDetailResponse {
        job,
        evaluations,
        application,
        drive_artifacts,
    }))
}

#[utoipa::path(
    post,
    path = "/api/jobs/ingest",
    request_body = IngestJobsRequest,
    responses(
        (status = 200, description = "Ingest jobs with canonical URL deduplication", body = IngestJobsResponse),
        (status = 400, description = "Invalid batch", body = crate::error::ErrorResponse)
    ),
    tag = "jobs"
)]
pub async fn ingest_jobs(
    State(state): State<AppState>,
    Json(req): Json<IngestJobsRequest>,
) -> Result<Json<IngestJobsResponse>, AppError> {
    if req.jobs.len() > 50 {
        return Err(AppError::BadRequest(
            "maximum ingest batch size is 50 jobs".to_string(),
        ));
    }

    let scanned: Vec<ScannedJob> = req
        .jobs
        .into_iter()
        .map(|j| ScannedJob {
            canonical_key: canonicalize_url_key(&j.url),
            url: j.url,
            company: j.company,
            title: j.title,
            location: j.location,
            workplace_type: j.workplace_type,
            posted_at: j.posted_at,
            source_type: j.source_type.unwrap_or_else(|| "manual".to_string()),
            jd_text: j.jd_text,
        })
        .collect();

    let outcome = state.ingest_scanned_jobs(&scanned, None).await?;
    Ok(Json(IngestJobsResponse {
        ingested: outcome.ingested,
        duplicates: outcome.duplicates,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_job() -> JobRecord {
        JobRecord {
            id: "job-1".into(),
            canonical_key: "example-co|staff-platform-engineer".into(),
            url: "https://jobs.example.com/staff-platform-engineer".into(),
            company: "Example Co".into(),
            title: "Staff Platform Engineer".into(),
            location: Some("Remote (US)".into()),
            workplace_type: Some("remote".into()),
            yoe_min: Some(8),
            yoe_max: None,
            yoe_label: Some("8+ years".into()),
            salary_min: Some(210_000),
            salary_max: Some(260_000),
            salary_currency: Some("USD".into()),
            posted_at: Some("2026-11-20T00:00:00Z".into()),
            source_type: "ats_board".into(),
            source_id: Some("greenhouse-example".into()),
            jd_text: Some("Build the platform.\nOwn reliability.".into()),
            guard_flags_json: None,
            triage_status: "pending_triage".into(),
            tier1_score: Some(87.5),
            tier1_json: Some(
                r#"{"job_id":"job-1","score":87.5,"recommended_status":"pending_triage","rationale":"Strong platform match.","archetype":"Platform"}"#
                    .into(),
            ),
            created_at: "2026-11-21T09:00:00Z".into(),
            updated_at: "2026-11-21T09:05:00Z".into(),
        }
    }

    fn unscored_job() -> JobRecord {
        JobRecord {
            id: "job-2".into(),
            canonical_key: "other-co|backend-engineer".into(),
            url: "https://jobs.example.com/backend-engineer".into(),
            company: "Other Co".into(),
            title: "Backend Engineer".into(),
            location: None,
            workplace_type: None,
            salary_min: None,
            salary_max: None,
            salary_currency: None,
            jd_text: None,
            triage_status: "pending_scoring".into(),
            tier1_score: None,
            tier1_json: None,
            ..sample_job()
        }
    }

    fn evaluation(id: &str, created_at: &str, blocks: &str) -> EvaluationRecord {
        EvaluationRecord {
            id: id.into(),
            job_id: "job-1".into(),
            tier: "neon".into(),
            model: "sonnet".into(),
            provider: Some("claude".into()),
            overall_score: Some(4.1),
            archetype: Some("Staff Platform Engineer".into()),
            blocks_json: Some(blocks.into()),
            report_md: Some("## Summary\n\nGood fit.".into()),
            rubric_score: None,
            created_at: created_at.into(),
        }
    }

    fn sample_detail() -> JobDetailResponse {
        JobDetailResponse {
            job: sample_job(),
            evaluations: vec![
                evaluation(
                    "eval-old",
                    "2026-11-21T10:00:00Z",
                    r#"{"A":"Older evaluation."}"#,
                ),
                evaluation(
                    "eval-new",
                    "2026-11-22T10:00:00Z",
                    r#"{"A":"Strong fit on platform work.","B":{"summary":"No Kubernetes operator experience.","rating":"minor","highlights":["Learnable in weeks"]},"G":{"verdict":"Posting looks genuine."}}"#,
                ),
            ],
            application: Some(ApplicationRecord {
                id: "app-1".into(),
                job_id: "job-1".into(),
                stage: "interviewing".into(),
                applied_at: Some("2026-11-23T00:00:00Z".into()),
                next_followup_at: Some("2026-11-30T00:00:00Z".into()),
                followup_count: 1,
                notes: None,
                gmail_thread_id: None,
                linear_issue_id: None,
                updated_at: "2026-11-23T00:00:00Z".into(),
            }),
            drive_artifacts: vec![DriveArtifactRecord {
                id: "art-1".into(),
                job_id: "job-1".into(),
                kind: "resume_doc".into(),
                drive_file_id: "drive-file-1".into(),
                drive_url: "https://docs.example.com/resume-1".into(),
                title: "Resume — Example Co".into(),
                created_at: "2026-11-22T12:00:00Z".into(),
            }],
        }
    }

    /// The web maps these shapes (`web/src/api/jobs.ts`). Regenerate with
    /// `UPDATE_FIXTURES=1 cargo test -p career-os-api jobs_fixture`.
    #[test]
    fn jobs_fixture_matches_web() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/src/__tests__/fixtures/jobs.json");
        let value = serde_json::json!({
            "list": ListJobsResponse { jobs: vec![sample_job(), unscored_job()], total: 2 },
            "detail": sample_detail(),
        });
        let actual = serde_json::to_string_pretty(&value).unwrap() + "\n";
        if std::env::var("UPDATE_FIXTURES").as_deref() == Ok("1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &actual).unwrap();
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("missing {}: {e}", path.display()));
        assert_eq!(
            actual, expected,
            "fixture out of date; see test doc comment"
        );
    }
}
