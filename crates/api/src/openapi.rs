use std::path::Path;

use utoipa::OpenApi;

use crate::{
    ai::{
        AiRouting, AiTier, CliKind, DealbreakerFlag, HydrogenScoreBreakdown, HydrogenScoreItem,
        NeonEvaluationResult,
    },
    error::ErrorResponse,
    profile::{ProfileFileStatus, ProfileTargetingSummary, ScoringWeights},
    routes::{
        ai::{
            AiUsageResponse, AiUsageTierStat, AntigravityStatus, AntigravityUsage,
            ClaudeUsageWindow, EvaluateJobRequest, EvaluateJobResponse, RescoreRequest,
            RescoreResponse, ScorePendingRequest, ScorePendingResponse,
        },
        auth::{
            GoogleAuthCallbackResponse, GoogleAuthDisconnectResponse, GoogleAuthStatusResponse,
            GoogleAuthUrlResponse,
        },
        comms::{CalendarReminderRequest, EmailDraftRequest},
        commute::{CommuteInfoResponse, CommutePreviewRequest},
        health::HealthResponse,
        jobs::{
            ApplicationRecord, CalendarEventRecord, DriveArtifactRecord, EmailDraftRecord,
            EvaluationRecord, GmailThreadRecord, IngestJobInput, IngestJobsRequest,
            IngestJobsResponse, JobDetailResponse, JobRecord, ListJobsResponse, QuickAddJobRequest,
        },
        profile::{ProfileStatusResponse, ProjectDocSummary},
        settings::{
            ListSettingsResponse, ListSyncRunsResponse, SettingRecord, SyncRunRecord,
            UpsertSettingRequest,
        },
        sources::{
            CreateSourceRequest, DeleteSourceResponse, FilteredAuditRecord, ListSourcesResponse,
            SourceRecord, TriggerScanRequest, TriggerScanResponse, UpdateSourceRequest,
        },
        tracker::{
            ApplicationWithJob, ListApplicationsResponse, StageCount, TrackerEntry,
            TrackerResponse, TrackerStatsResponse, UpdateApplicationRequest, UpdateTrackerRequest,
        },
        triage::{
            TriageAction, TriageBatchRequest, TriageBatchResponse, TriageRequest, TriageResponse,
        },
        workspace::{
            LinkThreadRequest, LinkThreadResponse, TodayAgendaItem, TodayFollowUpItem,
            TodayReplyItem, TodayResponse,
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
        crate::routes::jobs::quick_add_job,
        crate::routes::triage::triage_job,
        crate::routes::triage::triage_batch,
        crate::routes::tracker::list_applications,
        crate::routes::tracker::update_application,
        crate::routes::tracker::tracker_stats,
        crate::routes::tracker::get_tracker,
        crate::routes::tracker::patch_tracker,
        crate::routes::workspace::get_today,
        crate::routes::comms::save_email_draft,
        crate::routes::comms::create_calendar_reminder,
        crate::routes::workspace::sync_google_now,
        crate::routes::workspace::link_thread,
        crate::routes::sources::list_sources,
        crate::routes::sources::create_source,
        crate::routes::sources::update_source,
        crate::routes::sources::delete_source,
        crate::routes::sources::trigger_scan,
        crate::routes::ai::score_pending_jobs,
        crate::routes::ai::rescore_jobs,
        crate::routes::ai::evaluate_job,
        crate::routes::ai::get_ai_usage,
        crate::routes::profile::get_profile_status,
        crate::routes::auth::google_auth_status,
        crate::routes::auth::google_auth_url,
        crate::routes::auth::google_auth_callback,
        crate::routes::auth::google_auth_disconnect,
        crate::routes::commute::get_job_commute,
        crate::routes::commute::preview_commute,
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
            GmailThreadRecord,
            CalendarEventRecord,
            EmailDraftRecord,
            QuickAddJobRequest,
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
            TrackerEntry,
            TrackerResponse,
            UpdateTrackerRequest,
            TodayReplyItem,
            TodayAgendaItem,
            TodayFollowUpItem,
            TodayResponse,
            LinkThreadRequest,
            EmailDraftRequest,
            CalendarReminderRequest,
            LinkThreadResponse,
            SourceRecord,
            FilteredAuditRecord,
            ListSourcesResponse,
            CreateSourceRequest,
            DeleteSourceResponse,
            UpdateSourceRequest,
            TriggerScanRequest,
            TriggerScanResponse,
            AiTier,
            CliKind,
            AiRouting,
            ScoringWeights,
            HydrogenScoreBreakdown,
            DealbreakerFlag,
            HydrogenScoreItem,
            NeonEvaluationResult,
            ScorePendingRequest,
            ScorePendingResponse,
            RescoreRequest,
            RescoreResponse,
            EvaluateJobRequest,
            EvaluateJobResponse,
            ProfileFileStatus,
            ProfileTargetingSummary,
            ProjectDocSummary,
            ProfileStatusResponse,
            AiUsageTierStat,
            AiUsageResponse,
            ClaudeUsageWindow,
            AntigravityUsage,
            AntigravityStatus,
            GoogleAuthStatusResponse,
            GoogleAuthUrlResponse,
            GoogleAuthCallbackResponse,
            GoogleAuthDisconnectResponse,
            CommuteInfoResponse,
            CommutePreviewRequest,
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
        (name = "profile", description = "Read-only candidate profile and project docs"),
        (name = "auth", description = "Google OAuth integration"),
        (name = "commute", description = "Google Maps & Places LA commute distance"),
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
        assert!(json.contains("/api/jobs/{id}/commute"));
        assert!(json.contains("/api/commute/preview"));
        assert!(json.contains("AiUsageResponse") && json.contains("AiRouting"));
    }
}
