pub mod drive_docs;
pub mod rules;
pub mod yaml;

use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::profile::yaml::parse_yaml_to_json;

/// Weights for the 4-dimension fast triage 0–100 scoring rubric.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
pub struct ScoringWeights {
    pub role_stack: u32,
    pub level_reachability: u32,
    pub vibe_culture: u32,
    pub logistics_comp: u32,
}

impl Default for ScoringWeights {
    fn default() -> Self {
        Self {
            role_stack: 35,
            level_reachability: 25,
            vibe_culture: 25,
            logistics_comp: 15,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CandidateProfileMeta {
    #[serde(default)]
    pub years_of_experience: Option<f64>,
    #[serde(default)]
    pub authorized_in: Vec<String>,
    #[serde(default)]
    pub needs_sponsorship: Option<bool>,
    #[serde(default)]
    pub home_location: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LevelBandConfig {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub min_yoe: Option<u32>,
    #[serde(default)]
    pub max_yoe: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RolesTargetConfig {
    #[serde(default)]
    pub primary: Vec<String>,
    #[serde(default)]
    pub secondary: Vec<String>,
    #[serde(default)]
    pub level_band: LevelBandConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CompensationConfig {
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub target_range: Option<String>,
    #[serde(default)]
    pub minimum: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocationPolicyConfig {
    #[serde(default)]
    pub remote_us: Option<bool>,
    #[serde(default)]
    pub metro_hybrid_or_onsite: Vec<String>,
    #[serde(default)]
    pub strict_5day_nonlocal_onsite: Option<bool>,
    #[serde(default)]
    pub max_commute_minutes: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScannerFiltersConfig {
    #[serde(default)]
    pub max_yoe: Option<u32>,
    #[serde(default)]
    pub max_posting_age_days: Option<u32>,
    #[serde(default)]
    pub strict_location: Option<bool>,
    #[serde(default)]
    pub target_title_keywords: Vec<String>,
    #[serde(default)]
    pub excluded_seniority: Vec<String>,
    #[serde(default)]
    pub excluded_domains: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TargetingConfig {
    #[serde(default)]
    pub schema_version: Option<u32>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub use_in: Vec<String>,
    #[serde(default)]
    pub candidate: CandidateProfileMeta,
    #[serde(default)]
    pub roles: RolesTargetConfig,
    #[serde(default)]
    pub compensation: CompensationConfig,
    #[serde(default)]
    pub location_policy: LocationPolicyConfig,
    #[serde(default)]
    pub scoring_weights: ScoringWeights,
    #[serde(default)]
    pub scanner_filters: ScannerFiltersConfig,
    #[serde(default)]
    pub hard_dealbreakers: Vec<String>,
    #[serde(default)]
    pub positive_boosts: Vec<String>,
    #[serde(default)]
    pub tbd_topics: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillsConfig {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub use_in: Vec<String>,
    #[serde(default)]
    pub strong_production: serde_json::Value,
    #[serde(default)]
    pub working_hands_on: serde_json::Value,
    #[serde(default)]
    pub active_learning_wip: Vec<String>,
    #[serde(default)]
    pub not_my_lane: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MarkdownFrontmatter {
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub wip: Option<bool>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub use_in: Vec<String>,
    #[serde(default)]
    pub never_paste_verbatim_into_cv: Option<bool>,
    #[serde(default)]
    pub roles: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ProfileFileRecord {
    pub name: String,
    pub path: String,
    pub frontmatter: MarkdownFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFileStatus {
    pub name: String,
    pub path: String,
    pub status: String,
    pub updated_at: Option<String>,
    pub use_in: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTargetingSummary {
    pub primary_roles: Vec<String>,
    pub secondary_roles: Vec<String>,
    pub level_label: Option<String>,
    pub max_yoe: Option<u32>,
    pub weights: ScoringWeights,
    pub dealbreaker_count: usize,
    pub boost_count: usize,
}

#[derive(Debug, Clone, Default)]
pub struct LoadedProfile {
    pub loaded: bool,
    pub data_dir: String,
    pub targeting: Option<TargetingConfig>,
    pub skills: Option<SkillsConfig>,
    pub identity: Option<ProfileFileRecord>,
    pub psych_and_vibe: Option<ProfileFileRecord>,
    pub experience: Option<ProfileFileRecord>,
    pub projects: Vec<ProfileFileRecord>,
    pub files: Vec<ProfileFileStatus>,
    pub warnings: Vec<String>,
}

/// The profile every feature should use: the `DATA_DIR` files, with app rules
/// and linked Google Docs taking their place where they exist.
pub async fn load_effective_profile(pool: &sqlx::SqlitePool, data_dir: &Path) -> LoadedProfile {
    let mut profile = load_profile(data_dir);
    rules::apply(pool, &mut profile).await;
    drive_docs::apply(pool, &mut profile).await;
    profile
}

/// Parses optional leading `--- ... ---` YAML frontmatter from Markdown.
///
/// Frontmatter that exists but cannot be read is an error: it may carry
/// `status: tbd`, so callers must not use the body.
pub fn parse_markdown_frontmatter(raw: &str) -> Result<(MarkdownFrontmatter, &str), String> {
    let normalized = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let after_open = if let Some(rest) = normalized.strip_prefix("---\n") {
        rest
    } else if let Some(rest) = normalized.strip_prefix("---\r\n") {
        rest
    } else {
        return Ok((MarkdownFrontmatter::default(), raw));
    };

    if let Some(end_idx) = after_open
        .find("\n---\n")
        .or_else(|| after_open.find("\n---\r\n"))
    {
        let fm_str = &after_open[..end_idx];
        let after_marker = &after_open[end_idx + 4..];
        let body = after_marker
            .strip_prefix('\r')
            .unwrap_or(after_marker)
            .strip_prefix('\n')
            .unwrap_or(after_marker);
        let fm = serde_json::from_value::<MarkdownFrontmatter>(parse_yaml_to_json(fm_str)?)
            .map_err(|err| err.to_string())?;
        return Ok((fm, body));
    }

    Ok((MarkdownFrontmatter::default(), raw))
}

/// Strips markdown sections whose heading indicates `tbd` (e.g. `## TBD ...` or `(status: tbd)`)
/// and individual `tbd:` / `- tbd:` lines so undecided topics never leak as factual claims.
pub fn strip_tbd_sections(markdown: &str) -> String {
    let mut out = Vec::new();
    let mut skip_heading_level: Option<usize> = None;

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if let Some(level) = heading_level(trimmed) {
            if let Some(skip_lvl) = skip_heading_level {
                if level <= skip_lvl {
                    skip_heading_level = None;
                } else {
                    continue;
                }
            }
            if contains_tbd_marker(trimmed) {
                skip_heading_level = Some(level);
                continue;
            }
            out.push(line);
            continue;
        }

        if skip_heading_level.is_some() {
            continue;
        }

        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("- `tbd`:") || lower.starts_with("- tbd:") || lower.starts_with("tbd:")
        {
            continue;
        }
        out.push(line);
    }

    out.join("\n").trim().to_string()
}

fn heading_level(trimmed: &str) -> Option<usize> {
    let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ') {
        Some(hashes)
    } else {
        None
    }
}

fn contains_tbd_marker(heading: &str) -> bool {
    let lower = heading.to_ascii_lowercase();
    lower.contains("tbd") || lower.contains("status: tbd")
}

fn read_yaml_file<T: for<'de> Deserialize<'de>>(
    path: &Path,
    name: &str,
    rel_path: &str,
    files: &mut Vec<ProfileFileStatus>,
    warnings: &mut Vec<String>,
) -> Option<T> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            warnings.push(format!("failed reading {rel_path}: {err}"));
            return None;
        }
    };

    let json = match parse_yaml_to_json(&raw) {
        Ok(v) => v,
        Err(err) => {
            warnings.push(format!("invalid YAML in {rel_path}: {err}"));
            return None;
        }
    };

    let status = json
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let updated_at = json
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let use_in = json
        .get("use_in")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    files.push(ProfileFileStatus {
        name: name.to_string(),
        path: rel_path.to_string(),
        status,
        updated_at,
        use_in,
    });

    match serde_json::from_value::<T>(json) {
        Ok(parsed) => Some(parsed),
        Err(err) => {
            warnings.push(format!("schema mismatch in {rel_path}: {err}"));
            None
        }
    }
}

fn read_markdown_file(
    path: &Path,
    default_name: &str,
    rel_path: &str,
    files: &mut Vec<ProfileFileStatus>,
    warnings: &mut Vec<String>,
) -> Option<ProfileFileRecord> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            warnings.push(format!("failed reading {rel_path}: {err}"));
            return None;
        }
    };

    let (fm, body) = match parse_markdown_frontmatter(&raw) {
        Ok(parsed) => parsed,
        Err(err) => {
            warnings.push(format!(
                "invalid frontmatter in {rel_path}, file not used: {err}"
            ));
            return None;
        }
    };
    let status = fm
        .status
        .clone()
        .unwrap_or_else(|| "unspecified".to_string());
    let name = fm.name.clone().unwrap_or_else(|| default_name.to_string());

    files.push(ProfileFileStatus {
        name: name.clone(),
        path: rel_path.to_string(),
        status,
        updated_at: fm.updated_at.clone(),
        use_in: fm.use_in.clone(),
    });

    Some(ProfileFileRecord {
        name,
        path: rel_path.to_string(),
        frontmatter: fm,
        body: body.trim().to_string(),
    })
}

/// Loads the candidate's modular profile from `{data_dir}/profile/`.
/// Falls back cleanly with `loaded = false` when absent.
pub fn load_profile(data_dir: &Path) -> LoadedProfile {
    let profile_dir = data_dir.join("profile");
    let data_dir_str = data_dir.display().to_string();

    if !profile_dir.is_dir() {
        return LoadedProfile {
            loaded: false,
            data_dir: data_dir_str,
            warnings: vec![format!(
                "profile directory not found at {}",
                profile_dir.display()
            )],
            ..LoadedProfile::default()
        };
    }

    let mut files = Vec::new();
    let mut warnings = Vec::new();

    let targeting = read_yaml_file::<TargetingConfig>(
        &profile_dir.join("targeting.yml"),
        "targeting",
        "profile/targeting.yml",
        &mut files,
        &mut warnings,
    );
    let skills = read_yaml_file::<SkillsConfig>(
        &profile_dir.join("skills.yml"),
        "skills",
        "profile/skills.yml",
        &mut files,
        &mut warnings,
    );
    let identity = read_markdown_file(
        &profile_dir.join("identity.md"),
        "identity",
        "profile/identity.md",
        &mut files,
        &mut warnings,
    );
    let psych_and_vibe = read_markdown_file(
        &profile_dir.join("psych-and-vibe.md"),
        "psych-and-vibe",
        "profile/psych-and-vibe.md",
        &mut files,
        &mut warnings,
    );
    let experience = read_markdown_file(
        &profile_dir.join("experience.md"),
        "experience",
        "profile/experience.md",
        &mut files,
        &mut warnings,
    );

    let mut projects = Vec::new();
    let projects_dir = profile_dir.join("projects");
    if projects_dir.is_dir() {
        match fs::read_dir(&projects_dir) {
            Ok(entries) => {
                let mut paths: Vec<_> = entries
                    .filter_map(|e| e.ok().map(|ent| ent.path()))
                    .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
                    .collect();
                paths.sort();
                for path in paths {
                    let fname = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("project.md");
                    let rel = format!("profile/projects/{fname}");
                    if let Some(rec) =
                        read_markdown_file(&path, fname, &rel, &mut files, &mut warnings)
                    {
                        projects.push(rec);
                    }
                }
            }
            Err(err) => {
                warnings.push(format!("failed reading profile/projects: {err}"));
            }
        }
    }

    let loaded = targeting.is_some()
        || skills.is_some()
        || identity.is_some()
        || psych_and_vibe.is_some()
        || experience.is_some()
        || !projects.is_empty();

    LoadedProfile {
        loaded,
        data_dir: data_dir_str,
        targeting,
        skills,
        identity,
        psych_and_vibe,
        experience,
        projects,
        files,
        warnings,
    }
}

fn flatten_skill_value(val: &serde_json::Value) -> Vec<String> {
    match val {
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        serde_json::Value::Object(map) => {
            let mut groups = BTreeMap::new();
            for (k, v) in map {
                let items = flatten_skill_value(v);
                if !items.is_empty() {
                    groups.insert(k.clone(), items);
                }
            }
            groups
                .into_iter()
                .map(|(k, items)| format!("{k}: {}", items.join(", ")))
                .collect()
        }
        _ => Vec::new(),
    }
}

fn extract_markdown_section(markdown: &str, heading_needle: &str) -> Option<String> {
    let needle = heading_needle.to_ascii_lowercase();
    let mut capturing_level: Option<usize> = None;
    let mut lines = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if let Some(lvl) = heading_level(trimmed) {
            if let Some(cap_lvl) = capturing_level {
                if lvl <= cap_lvl {
                    break;
                }
            } else if trimmed.to_ascii_lowercase().contains(&needle) {
                capturing_level = Some(lvl);
                continue;
            }
        } else if capturing_level.is_some() {
            lines.push(line);
        }
    }

    let text = lines.join("\n").trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push_str("\n...[truncated]");
    out
}

impl LoadedProfile {
    pub fn scoring_weights(&self) -> ScoringWeights {
        self.targeting
            .as_ref()
            .map(|t| t.scoring_weights.clone())
            .unwrap_or_default()
    }

    pub fn targeting_summary(&self) -> Option<ProfileTargetingSummary> {
        let t = self.targeting.as_ref()?;
        Some(ProfileTargetingSummary {
            primary_roles: t.roles.primary.clone(),
            secondary_roles: t.roles.secondary.clone(),
            level_label: t.roles.level_band.label.clone(),
            max_yoe: t.scanner_filters.max_yoe.or(t.roles.level_band.max_yoe),
            weights: t.scoring_weights.clone(),
            dealbreaker_count: t.hard_dealbreakers.len(),
            boost_count: t.positive_boosts.len(),
        })
    }

    /// Converts `targeting.yml` `scanner_filters` into the `portalsConfig` JSON sent to `scanner`.
    pub fn to_portals_config(&self, default_max_posting_age_days: u32) -> serde_json::Value {
        let Some(t) = &self.targeting else {
            return serde_json::json!({
                "max_posting_age_days": default_max_posting_age_days
            });
        };
        let sf = &t.scanner_filters;
        let max_age = sf
            .max_posting_age_days
            .unwrap_or(default_max_posting_age_days);
        let mut scanner_filters = serde_json::Map::new();
        if let Some(max_yoe) = sf.max_yoe.or(t.roles.level_band.max_yoe) {
            scanner_filters.insert("max_yoe".into(), serde_json::json!(max_yoe));
        }
        if let Some(strict) = sf.strict_location {
            scanner_filters.insert("strict_location".into(), serde_json::json!(strict));
        }
        if !sf.target_title_keywords.is_empty() {
            scanner_filters.insert(
                "target_title_keywords".into(),
                serde_json::json!(sf.target_title_keywords),
            );
        }
        if !sf.excluded_seniority.is_empty() {
            scanner_filters.insert(
                "excluded_seniority".into(),
                serde_json::json!(sf.excluded_seniority),
            );
        }
        if !sf.excluded_domains.is_empty() {
            scanner_filters.insert(
                "excluded_domains".into(),
                serde_json::json!(sf.excluded_domains),
            );
        }
        serde_json::json!({
            "max_posting_age_days": max_age,
            "scanner_filters": serde_json::Value::Object(scanner_filters),
        })
    }

    /// Builds a compact digest (~2,500–4,500 chars) for fast batch triage scoring.
    pub fn build_triage_digest(&self, cached_doc_digests: &[String]) -> Option<String> {
        if !self.loaded {
            return None;
        }

        let mut sections = Vec::new();

        if let Some(t) = &self.targeting {
            let mut lines = Vec::new();
            lines.push("## Target Roles, Level & Logistics".to_string());
            if !t.roles.primary.is_empty() {
                lines.push(format!("- Primary roles: {}", t.roles.primary.join(", ")));
            }
            if !t.roles.secondary.is_empty() {
                lines.push(format!(
                    "- Secondary roles: {}",
                    t.roles.secondary.join(", ")
                ));
            }
            if let Some(label) = &t.roles.level_band.label {
                lines.push(format!(
                    "- Target level: {label} (YOE candidate: {}, band {}-{})",
                    t.candidate
                        .years_of_experience
                        .map(|y| y.to_string())
                        .unwrap_or_else(|| "unspecified".into()),
                    t.roles.level_band.min_yoe.unwrap_or(0),
                    t.roles.level_band.max_yoe.unwrap_or(4),
                ));
            }
            if let Some(home) = &t.candidate.home_location {
                lines.push(format!(
                    "- Location & auth: home {home}; remote_us={}; metro={}; needs_sponsorship={}",
                    t.location_policy.remote_us.unwrap_or(true),
                    t.location_policy.metro_hybrid_or_onsite.join("/"),
                    t.candidate.needs_sponsorship.unwrap_or(false),
                ));
            }
            if let Some(range) = &t.compensation.target_range {
                lines.push(format!(
                    "- Compensation target ({}): {}",
                    t.compensation.currency.as_deref().unwrap_or("USD"),
                    range
                ));
            }
            if !t.hard_dealbreakers.is_empty() {
                lines.push("- HARD DEALBREAKERS (cap score <=35, recommend skipped):".into());
                for db in &t.hard_dealbreakers {
                    lines.push(format!("  * {db}"));
                }
            }
            if !t.positive_boosts.is_empty() {
                lines.push("- Positive fit signals:".into());
                for boost in &t.positive_boosts {
                    lines.push(format!("  * {boost}"));
                }
            }
            sections.push(lines.join("\n"));
        }

        if let Some(skills) = &self.skills {
            let mut lines = vec!["## Skills".to_string()];
            let prod = flatten_skill_value(&skills.strong_production);
            if !prod.is_empty() {
                lines.push("- Strong production:".into());
                for item in prod {
                    lines.push(format!("  * {item}"));
                }
            }
            let hands = flatten_skill_value(&skills.working_hands_on);
            if !hands.is_empty() {
                lines.push("- Hands-on / working:".into());
                for item in hands {
                    lines.push(format!("  * {item}"));
                }
            }
            if !skills.active_learning_wip.is_empty() {
                lines.push(format!(
                    "- Active learning / WIP: {}",
                    skills.active_learning_wip.join("; ")
                ));
            }
            if !skills.not_my_lane.is_empty() {
                lines.push(format!(
                    "- Not my lane (low fit): {}",
                    skills.not_my_lane.join("; ")
                ));
            }
            sections.push(lines.join("\n"));
        }

        if let Some(vibe) = &self.psych_and_vibe {
            if vibe.frontmatter.status.as_deref() != Some("tbd") {
                let clean = strip_tbd_sections(&vibe.body);
                let mut lines = vec!["## Vibe & Culture Fit Signals".to_string()];
                for heading in ["Likes", "Dislikes", "Culture Green Flags", "Anti-Hype"] {
                    if let Some(sec) = extract_markdown_section(&clean, heading) {
                        lines.push(format!("### {heading}\n{}", truncate_chars(&sec, 700)));
                    }
                }
                if lines.len() > 1 {
                    sections.push(lines.join("\n"));
                }
            }
        }

        let active_projects: Vec<_> = self
            .projects
            .iter()
            .filter(|p| p.frontmatter.status.as_deref() != Some("tbd"))
            .collect();
        if !active_projects.is_empty() {
            let mut lines = vec!["## Key Projects".to_string()];
            for p in active_projects {
                let clean = strip_tbd_sections(&p.body);
                let one_liner = extract_markdown_section(&clean, "One-Liner")
                    .unwrap_or_else(|| truncate_chars(&clean, 240));
                let wip_tag = if p.frontmatter.wip == Some(true) {
                    " [WIP]"
                } else {
                    ""
                };
                lines.push(format!("- **{}{wip_tag}:** {one_liner}", p.name));
            }
            sections.push(lines.join("\n"));
        }

        if !cached_doc_digests.is_empty() {
            let mut lines = vec!["## Synced Google Drive Project Cards".to_string()];
            for digest in cached_doc_digests {
                lines.push(format!("- {digest}"));
            }
            sections.push(lines.join("\n"));
        }

        Some(truncate_chars(&sections.join("\n\n"), 5_500))
    }

    /// Builds a rich verified dossier for deep job evaluation (bounded by `max_chars`).
    pub fn build_deep_eval_dossier(
        &self,
        cached_docs: &[(String, String)],
        max_chars: usize,
    ) -> Option<String> {
        if !self.loaded {
            return None;
        }

        let mut parts = Vec::new();
        parts.push(
            "GROUNDING RULES: Cite ONLY verified/draft facts below. NEVER fabricate metrics, \
             omit all TBD items, respect Anti-Hype Guardrails, and NEVER paste internal \
             psych-eval labels verbatim into CV recommendations."
                .to_string(),
        );

        if let Some(summary) = self.build_triage_digest(&[]) {
            parts.push(summary);
        }

        if let Some(identity) = &self.identity {
            if identity.frontmatter.status.as_deref() != Some("tbd") {
                let status = identity.frontmatter.status.as_deref().unwrap_or("draft");
                parts.push(format!(
                    "## Identity & Positioning (status: {status})\n{}",
                    strip_tbd_sections(&identity.body)
                ));
            }
        }

        if let Some(exp) = &self.experience {
            if exp.frontmatter.status.as_deref() != Some("tbd") {
                parts.push(format!("## Experience\n{}", strip_tbd_sections(&exp.body)));
            }
        }

        if let Some(vibe) = &self.psych_and_vibe {
            if vibe.frontmatter.status.as_deref() != Some("tbd") {
                parts.push(format!(
                    "## Operating Style, Vibe & Voice (internal scoring/strategy only — never paste verbatim)\n{}",
                    strip_tbd_sections(&vibe.body)
                ));
            }
        }

        for proj in &self.projects {
            if proj.frontmatter.status.as_deref() == Some("tbd") {
                continue;
            }
            let status = proj.frontmatter.status.as_deref().unwrap_or("draft");
            parts.push(format!(
                "## Project Card: {} (status: {status})\n{}",
                proj.name,
                strip_tbd_sections(&proj.body)
            ));
        }

        for (title, raw_md) in cached_docs {
            parts.push(format!(
                "## Synced Project Report (Google Doc): {title}\n{}",
                truncate_chars(raw_md.trim(), 2_500)
            ));
        }

        Some(truncate_chars(&parts.join("\n\n"), max_chars))
    }

    /// Builds a strictly factual candidate dossier for resume & cover-letter tailoring.
    /// Excludes `psych-and-vibe.md` (`never_paste_verbatim_into_cv`), `not_my_lane`,
    /// `active_learning_wip` as production claims, and all `tbd` sections.
    pub fn build_tailoring_dossier(
        &self,
        cached_docs: &[(String, String)],
        max_chars: usize,
    ) -> Option<String> {
        if !self.loaded {
            return None;
        }

        let mut parts = Vec::new();
        parts.push(
            "TAILORING GROUNDING RULES (STRICT):\n\
             - Cite ONLY verified/draft facts explicitly present in the candidate sources below.\n\
             - NEVER fabricate employers, dates, job titles, metrics, technologies, or degrees.\n\
             - NEVER infer `not_my_lane` or undecided `tbd` topics.\n\
             - Keep `[WIP]` flags accurate if referencing work-in-progress projects.\n\
             - Every item in `grounded_bullets` MUST cite the exact `source_file` header shown below."
                .to_string(),
        );

        if let Some(t) = &self.targeting {
            let mut lines =
                vec!["## Candidate Meta (source_file: profile/targeting.yml)".to_string()];
            if let Some(yoe) = t.candidate.years_of_experience {
                lines.push(format!("- Years of experience: {yoe}"));
            }
            if !t.candidate.authorized_in.is_empty() {
                lines.push(format!(
                    "- Work authorization: {}",
                    t.candidate.authorized_in.join(", ")
                ));
            }
            if let Some(home) = &t.candidate.home_location {
                lines.push(format!("- Home area: {home}"));
            }
            if !t.roles.primary.is_empty() {
                lines.push(format!("- Target roles: {}", t.roles.primary.join(", ")));
            }
            if lines.len() > 1 {
                parts.push(lines.join("\n"));
            }
        }

        if let Some(identity) = &self.identity {
            if identity.frontmatter.status.as_deref() != Some("tbd") {
                let clean = strip_tbd_sections(&identity.body);
                if !clean.is_empty() {
                    parts.push(format!(
                        "## Identity & Positioning (source_file: {})\n{}",
                        identity.path, clean
                    ));
                }
            }
        }

        if let Some(exp) = &self.experience {
            if exp.frontmatter.status.as_deref() != Some("tbd") {
                let clean = strip_tbd_sections(&exp.body);
                if !clean.is_empty() {
                    parts.push(format!(
                        "## Experience (source_file: {})\n{}",
                        exp.path, clean
                    ));
                }
            }
        }

        if let Some(skills) = &self.skills {
            let mut lines =
                vec!["## Verified Skills (source_file: profile/skills.yml)".to_string()];
            let prod = flatten_skill_value(&skills.strong_production);
            if !prod.is_empty() {
                lines.push("- Strong production:".into());
                for item in prod {
                    lines.push(format!("  * {item}"));
                }
            }
            let hands = flatten_skill_value(&skills.working_hands_on);
            if !hands.is_empty() {
                lines.push("- Working hands-on:".into());
                for item in hands {
                    lines.push(format!("  * {item}"));
                }
            }
            if lines.len() > 1 {
                parts.push(lines.join("\n"));
            }
        }

        for proj in &self.projects {
            if proj.frontmatter.status.as_deref() == Some("tbd") {
                continue;
            }
            let clean = strip_tbd_sections(&proj.body);
            if clean.is_empty() {
                continue;
            }
            let wip_tag = if proj.frontmatter.wip == Some(true) {
                " [WIP]"
            } else {
                ""
            };
            parts.push(format!(
                "## Project: {}{} (source_file: {})\n{}",
                proj.name, wip_tag, proj.path, clean
            ));
        }

        for (title, raw_md) in cached_docs {
            let clean = strip_tbd_sections(raw_md.trim());
            if !clean.is_empty() {
                parts.push(format!(
                    "## Synced Project Report: {title} (source_file: project_doc:{title})\n{}",
                    truncate_chars(&clean, 3_000)
                ));
            }
        }

        Some(truncate_chars(&parts.join("\n\n"), max_chars))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_profile_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "career-os-profile-test-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(dir.join("profile/projects")).unwrap();
        dir
    }

    #[test]
    fn missing_profile_dir_falls_back_gracefully() {
        let missing = std::env::temp_dir().join(format!("missing-{}", uuid::Uuid::new_v4()));
        let loaded = load_profile(&missing);
        assert!(!loaded.loaded);
        assert!(loaded.build_triage_digest(&[]).is_none());
        assert!(loaded.build_deep_eval_dossier(&[], 4000).is_none());
        assert_eq!(loaded.scoring_weights(), ScoringWeights::default());
        assert_eq!(loaded.to_portals_config(45)["max_posting_age_days"], 45);
    }

    #[test]
    fn loads_synthetic_profile_strips_tbd_and_builds_digests() {
        let root = temp_profile_dir("synthetic");
        let p = root.join("profile");

        fs::write(
            p.join("targeting.yml"),
            r#"
schema_version: 1
status: verified
updated_at: "2026-11-28"
candidate:
  years_of_experience: 2
  authorized_in: ["United States"]
  needs_sponsorship: false
  home_location: "Los Angeles, CA"
roles:
  primary: ["Platform Engineer", "DevOps Engineer"]
  secondary: ["Site Reliability Engineer"]
  level_band:
    label: "Junior-Mid"
    min_yoe: 0
    max_yoe: 4
scoring_weights:
  role_stack: 40
  level_reachability: 20
  vibe_culture: 25
  logistics_comp: 15
scanner_filters:
  max_yoe: 4
  max_posting_age_days: 30
  strict_location: true
  target_title_keywords: ["Platform Engineer"]
  excluded_domains: ["Aerospace"]
hard_dealbreakers:
  - "Aerospace hardware Systems Engineer"
positive_boosts:
  - "Self-serve Kubernetes platforms"
"#,
        )
        .unwrap();

        fs::write(
            p.join("skills.yml"),
            r#"
status: verified
updated_at: "2026-11-28"
strong_production:
  platform: ["Kubernetes", "ArgoCD"]
not_my_lane:
  - "Aerospace MBSE"
"#,
        )
        .unwrap();

        fs::write(
            p.join("identity.md"),
            "---\nstatus: draft\nupdated_at: \"2026-11-28\"\nuse_in: [neon]\n---\n\n# Identity\n\nBuilder focused on platforms.\n\n## Open TBD Section\n\n- `tbd`: secret undecided timeline\n",
        )
        .unwrap();

        fs::write(
            p.join("psych-and-vibe.md"),
            "---\nstatus: verified\nnever_paste_verbatim_into_cv: true\n---\n\n## Likes / Energy Givers\n- Ownership of CI/CD.\n\n## Dislikes\n- Click-ops.\n\n## Personal Hobbies (`status: tbd`)\n- Secret hobby placeholder.\n",
        )
        .unwrap();

        fs::write(
            p.join("experience.md"),
            "---\nstatus: verified\n---\n\n### Example Co\n- Built internal developer platform.\n",
        )
        .unwrap();

        fs::write(
            p.join("projects/alpha.md"),
            "---\nslug: alpha\nname: \"Project Alpha\"\nstatus: verified\nwip: true\n---\n\n## One-Liner\nSelf-serve preview deploys.\n",
        )
        .unwrap();

        fs::write(
            p.join("projects/unfinished.md"),
            "---\nslug: unfinished\nname: \"Secret TBD Project\"\nstatus: tbd\n---\n\n## One-Liner\nShould not appear.\n",
        )
        .unwrap();

        let loaded = load_profile(&root);
        assert!(loaded.loaded);
        assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
        assert_eq!(loaded.scoring_weights().role_stack, 40);

        let portals = loaded.to_portals_config(45);
        assert_eq!(portals["max_posting_age_days"], 30);
        assert_eq!(
            portals["scanner_filters"]["excluded_domains"][0],
            "Aerospace"
        );

        let h_digest = loaded
            .build_triage_digest(&["Doc Card: Migration notes".to_string()])
            .unwrap();
        assert!(h_digest.contains("Platform Engineer"));
        assert!(h_digest.contains("Aerospace hardware Systems Engineer"));
        assert!(h_digest.contains("Project Alpha [WIP]"));
        assert!(h_digest.contains("Doc Card: Migration notes"));
        assert!(!h_digest.contains("Secret TBD Project"));
        assert!(!h_digest.contains("Secret hobby placeholder"));

        let deep_dossier = loaded
            .build_deep_eval_dossier(&[("Report 1".into(), "Full report body".into())], 10_000)
            .unwrap();
        assert!(deep_dossier.contains("Example Co"));
        assert!(deep_dossier.contains("Full report body"));
        assert!(!deep_dossier.contains("secret undecided timeline"));
        assert!(!deep_dossier.contains("Secret hobby placeholder"));

        let empty_profile = LoadedProfile::default();
        assert!(empty_profile.build_tailoring_dossier(&[], 10_000).is_none());

        let tailor_dossier = loaded
            .build_tailoring_dossier(
                &[(
                    "Migration Report".into(),
                    "Reduced p99 latency by 40%.".into(),
                )],
                20_000,
            )
            .unwrap();
        assert!(tailor_dossier.contains("source_file: profile/experience.md"));
        assert!(tailor_dossier.contains("Example Co"));
        assert!(tailor_dossier.contains("source_file: profile/identity.md"));
        assert!(tailor_dossier.contains("source_file: profile/skills.yml"));
        assert!(tailor_dossier.contains("Kubernetes, ArgoCD"));
        assert!(
            tailor_dossier.contains("Project Alpha [WIP] (source_file: profile/projects/alpha.md)")
        );
        assert!(tailor_dossier.contains("source_file: project_doc:Migration Report"));
        assert!(tailor_dossier.contains("Reduced p99 latency by 40%."));
        // Strictly excluded from CV factual claims:
        assert!(!tailor_dossier.contains("psych-and-vibe"));
        assert!(!tailor_dossier.contains("Click-ops"));
        assert!(!tailor_dossier.contains("Aerospace MBSE"));
        assert!(!tailor_dossier.contains("Secret TBD Project"));
        assert!(!tailor_dossier.contains("secret undecided timeline"));

        let _ = fs::remove_dir_all(root);
    }
}
