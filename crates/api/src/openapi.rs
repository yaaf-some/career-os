use std::path::Path;

use utoipa::OpenApi;

use crate::{
    ai::{AiTier, AiUsageReport, HydrogenScoreItem, NeonEvaluationResult},
    error::ErrorResponse,
    routes::{
        ai::{
            AiUsageSummaryResponse, AiUsageTierStat, EvaluateJobRequest, EvaluateJobResponse,
            ScorePendingRequest, ScorePendingResponse,
        },
        auth::{
            GoogleAuthCallbackResponse, GoogleAuthDisconnectResponse, GoogleAuthStatusResponse,
            GoogleAuthUrlResponse,
        },
        health::HealthResponse,
        jobs::{
            ApplicationRecord, DriveArtifactRecord, EvaluationRecord, IngestJobInput,
            IngestJobsRequest, IngestJobsResponse, JobDetailResponse, JobRecord,
            ListJobsResponse,
        },
        settings::{
            ListSettingsResponse, ListSyncRunsResponse, SettingRecord, SyncRunRecord,
            UpsertSettingRequest,
        },
        sources::{
            CreateSourceRequest, DeleteSourceResponse, ListSourcesResponse, SourceRecord,
            TriggerScanRequest, TriggerScanResponse, UpdateSourceRequest,
        },
        tracker::{
            ApplicationWithJob, ListApplicationsResponse, StageCount, TrackerStatsResponse,
            UpdateApplicationRequest,
        },
        triage::{
            TriageAction, TriageBatchRequest, TriageBatchResponse, TriageRequest, TriageResponse,
        },
    },
};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Career OS API",
        version = "0.1.0",
        description = "Self-hosted career operations API (SQLite + Tailscale auth + AI bridge)"
    ),
    paths(
        crate::routes::health::healthz,
        crate::routes::jobs::list_jobs,
        crate::routes::jobs::get_job,
        crate::routes::jobs::ingest_jobs,
        crate::routes::triage::triage_job,
        crate::routes::triage::triage_batch,
        crate::routes::tracker::list_applications,
        crate::routes::tracker::update_application,
        crate::routes::tracker::tracker_stats,
        crate::routes::sources::list_sources,
        crate::routes::sources::create_source,
        crate::routes::sources::update_source,
        crate::routes::sources::delete_source,
        crate::routes::sources::trigger_scan,
        crate::routes::ai::score_pending_jobs,
        crate::routes::ai::evaluate_job,
        crate::routes::ai::get_ai_usage,
        crate::routes::auth::google_auth_status,
        crate::routes::auth::google_auth_url,
        crate::routes::auth::google_auth_callback,
        crate::routes::auth::google_auth_disconnect,
        crate::routes::settings::list_settings,
        crate::routes::settings::upsert_setting,
        crate::routes::settings::list_sync_runs,
    ),
    components(
        schemas(
            ErrorResponse,
            HealthResponse,
            JobRecord,
            EvaluationRecord,
            ApplicationRecord,
            DriveArtifactRecord,
            ListJobsResponse,
            JobDetailResponse,
            IngestJobInput,
            IngestJobsRequest,
            IngestJobsResponse,
            TriageAction,
            TriageRequest,
            TriageBatchRequest,
            TriageResponse,
            TriageBatchResponse,
            ApplicationWithJob,
            ListApplicationsResponse,
            UpdateApplicationRequest,
            StageCount,
            TrackerStatsResponse,
            SourceRecord,
            ListSourcesResponse,
            CreateSourceRequest,
            DeleteSourceResponse,
            UpdateSourceRequest,
            TriggerScanRequest,
            TriggerScanResponse,
            AiTier,
            AiUsageReport,
            HydrogenScoreItem,
            NeonEvaluationResult,
            ScorePendingRequest,
            ScorePendingResponse,
            EvaluateJobRequest,
            EvaluateJobResponse,
            AiUsageTierStat,
            AiUsageSummaryResponse,
            GoogleAuthStatusResponse,
            GoogleAuthUrlResponse,
            GoogleAuthCallbackResponse,
            GoogleAuthDisconnectResponse,
            SettingRecord,
            ListSettingsResponse,
            UpsertSettingRequest,
            SyncRunRecord,
            ListSyncRunsResponse,
        )
    ),
    tags(
        (name = "health", description = "Health check"),
        (name = "jobs", description = "Job ingestion and query"),
        (name = "triage", description = "Job triage actions"),
        (name = "tracker", description = "Application tracker and stats"),
        (name = "sources", description = "ATS and social job sources"),
        (name = "ai", description = "Tiered AI scoring and evaluation"),
        (name = "auth", description = "Google OAuth integration"),
        (name = "settings", description = "Settings and sync run logs")
    )
)]
pub struct ApiDoc;

pub fn export_openapi_to_file(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let json = serde_json::to_string_pretty(&ApiDoc::openapi())?;
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openapi_spec_serializes_with_expected_paths() {
        let doc = ApiDoc::openapi();
        let json = serde_json::to_string(&doc).expect("serialize openapi");
        assert!(json.contains("/healthz"));
        assert!(json.contains("/api/jobs"));
        assert!(json.contains("/api/triage/{id}"));
        assert!(json.contains("/api/ai/evaluate/{job_id}"));
    }
}
