use std::path::Path;

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Career OS API",
        version = "0.1.0",
        description = "Self-hosted career operations API (SQLite + Tailscale auth + AI bridge)"
    ),
    // Types no route references directly.
    components(schemas(
        crate::ai::AiRouting,
        crate::ai::CliKind,
        crate::ai::ProjectDocDigest,
        crate::ai::RoutingMode
    )),
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
struct ApiDoc;

/// The full spec: shared information plus each route module's own paths.
pub fn spec() -> utoipa::openapi::OpenApi {
    let mut spec = ApiDoc::openapi();
    crate::routes::merge_docs(&mut spec);
    spec
}

pub fn export_openapi_to_file(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let json = serde_json::to_string_pretty(&spec())?;
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openapi_spec_serializes_with_expected_paths() {
        let doc = spec();
        let json = serde_json::to_string(&doc).expect("serialize openapi");
        assert!(json.contains("/healthz"));
        assert!(json.contains("/api/jobs"));
        assert!(json.contains("/api/triage/{id}"));
        assert!(json.contains("/api/ai/evaluate/{job_id}"));
        assert!(json.contains("/api/jobs/{id}/commute"));
        assert!(json.contains("/api/jobs/{id}/tailor"));
        assert!(json.contains("/api/commute/preview"));
        assert!(json.contains("/api/integrations/linear"));
        assert!(json.contains("AiUsageResponse") && json.contains("AiRouting"));
    }
}
