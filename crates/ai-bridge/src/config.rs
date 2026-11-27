use std::{fmt::Display, path::PathBuf, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliProviderKind {
    Claude,
    Agy,
}

impl CliProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Agy => "agy",
        }
    }

    pub fn other(&self) -> Self {
        match self {
            Self::Claude => Self::Agy,
            Self::Agy => Self::Claude,
        }
    }

    pub fn from_str_lossy(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "claude" => Some(Self::Claude),
            "agy" => Some(Self::Agy),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("AI_BRIDGE_TOKEN is not set")]
    TokenMissing,
    #[error("AI_BRIDGE_TOKEN is too short (minimum 32 characters)")]
    TokenTooShort,
    #[error("AI_BRIDGE_TOKEN is a placeholder; generate one with `openssl rand -hex 32`")]
    TokenPlaceholder,
    #[error("invalid {var}: {reason}")]
    Invalid { var: &'static str, reason: String },
    #[error("set AI_BRIDGE_WORKDIR or HOME")]
    WorkdirUnresolvable,
}

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub bind_addr: String,
    pub bearer_token: Option<String>,
    pub primary_provider: CliProviderKind,
    pub claude_bin: String,
    pub agy_bin: String,
    pub claude_hydrogen_model: String,
    pub claude_neon_model: String,
    pub claude_carbon_model: String,
    pub agy_hydrogen_model: String,
    pub agy_neon_model: String,
    pub agy_carbon_model: String,
    pub default_timeout_secs: u64,
    pub cooldown_secs: u64,
    pub claude_statusline_path: Option<PathBuf>,
    pub workdir: PathBuf,
    pub max_concurrency: usize,
    pub statusline_max_age_secs: u64,
    /// agy persists every conversation under `<root>/<conversation_id>`; the runner deletes it after each run.
    pub agy_brain_root: Option<PathBuf>,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:8787".to_string(),
            bearer_token: None,
            primary_provider: CliProviderKind::Claude,
            claude_bin: "claude".to_string(),
            agy_bin: "agy".to_string(),
            claude_hydrogen_model: "haiku".to_string(),
            claude_neon_model: "sonnet".to_string(),
            claude_carbon_model: "opus".to_string(),
            agy_hydrogen_model: "gemini-4-hydrogen-medium".to_string(),
            agy_neon_model: "gemini-4-neon-medium".to_string(),
            agy_carbon_model: "gemini-4-carbon-medium".to_string(),
            default_timeout_secs: 90,
            cooldown_secs: 300,
            claude_statusline_path: None,
            workdir: PathBuf::from("career-os-ai-bridge-work"),
            max_concurrency: 2,
            statusline_max_age_secs: 900,
            agy_brain_root: None,
        }
    }
}

impl BridgeConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let env_non_empty = |key: &str| {
            get(key)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };

        let mut cfg = Self::default();
        if let Some(v) = env_non_empty("AI_BRIDGE_BIND") {
            cfg.bind_addr = v;
        }
        let token = env_non_empty("AI_BRIDGE_TOKEN").ok_or(ConfigError::TokenMissing)?;
        validate_token(&token)?;
        cfg.bearer_token = Some(token);

        if let Some(v) =
            env_non_empty("AI_BRIDGE_PRIMARY").and_then(|s| CliProviderKind::from_str_lossy(&s))
        {
            cfg.primary_provider = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_CLAUDE_BIN") {
            cfg.claude_bin = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_AGY_BIN") {
            cfg.agy_bin = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_CLAUDE_HYDROGEN_MODEL") {
            cfg.claude_hydrogen_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_CLAUDE_NEON_MODEL") {
            cfg.claude_neon_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_CLAUDE_CARBON_MODEL") {
            cfg.claude_carbon_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_AGY_HYDROGEN_MODEL") {
            cfg.agy_hydrogen_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_AGY_NEON_MODEL") {
            cfg.agy_neon_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_AGY_CARBON_MODEL") {
            cfg.agy_carbon_model = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_TIMEOUT_SECS").and_then(|s| s.parse().ok()) {
            cfg.default_timeout_secs = v;
        }
        if let Some(v) = env_non_empty("AI_BRIDGE_COOLDOWN_SECS").and_then(|s| s.parse().ok()) {
            cfg.cooldown_secs = v;
        }
        cfg.claude_statusline_path = env_non_empty("CLAUDE_STATUSLINE_PATH").map(PathBuf::from);

        cfg.workdir = match env_non_empty("AI_BRIDGE_WORKDIR") {
            Some(v) => PathBuf::from(v),
            None => match env_non_empty("HOME") {
                Some(home) => {
                    PathBuf::from(home).join("Library/Application Support/career-os-ai-bridge/work")
                }
                None => return Err(ConfigError::WorkdirUnresolvable),
            },
        };

        cfg.agy_brain_root = env_non_empty("AI_BRIDGE_AGY_BRAIN_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                env_non_empty("HOME")
                    .map(|h| PathBuf::from(h).join(".gemini/antigravity-cli/brain"))
            });

        if let Some(raw) = env_non_empty("AI_BRIDGE_MAX_CONCURRENCY") {
            cfg.max_concurrency = match parse_var::<usize>(&raw, "AI_BRIDGE_MAX_CONCURRENCY")? {
                0 => {
                    return Err(ConfigError::Invalid {
                        var: "AI_BRIDGE_MAX_CONCURRENCY",
                        reason: "must be at least 1".to_string(),
                    })
                }
                n => n,
            };
        }

        if let Some(raw) = env_non_empty("AI_BRIDGE_STATUSLINE_MAX_AGE_SECS") {
            cfg.statusline_max_age_secs =
                parse_var::<u64>(&raw, "AI_BRIDGE_STATUSLINE_MAX_AGE_SECS")?;
        }

        Ok(cfg)
    }
}

/// Validates a bearer token. Never includes the token value in error messages.
fn validate_token(token: &str) -> Result<(), ConfigError> {
    if token
        .chars()
        .any(|c| c.is_whitespace() || c == '<' || c == '>')
    {
        return Err(ConfigError::TokenPlaceholder);
    }
    let lowered = token.to_ascii_lowercase();
    if matches!(lowered.as_str(), "change-me" | "changeme" | "replace-me") {
        return Err(ConfigError::TokenPlaceholder);
    }
    if token.chars().count() < 32 {
        return Err(ConfigError::TokenTooShort);
    }
    Ok(())
}

fn parse_var<T>(raw: &str, var: &'static str) -> Result<T, ConfigError>
where
    T: FromStr,
    T::Err: Display,
{
    raw.parse::<T>().map_err(|e| ConfigError::Invalid {
        var,
        reason: format!("not a valid number ({e})"),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    /// Builds a config from a valid token and HOME, plus the given overrides.
    fn cfg(extra: &[(&str, &str)]) -> Result<BridgeConfig, ConfigError> {
        let mut all = vec![("AI_BRIDGE_TOKEN", TOKEN), ("HOME", "/Users/test")];
        all.extend_from_slice(extra);
        BridgeConfig::from_lookup(lookup(&all))
    }

    #[test]
    fn missing_token_is_rejected() {
        let err = BridgeConfig::from_lookup(lookup(&[("HOME", "/Users/test")])).unwrap_err();
        assert!(matches!(err, ConfigError::TokenMissing));
    }

    #[test]
    fn blank_token_counts_as_missing() {
        let err = cfg(&[("AI_BRIDGE_TOKEN", "   ")]).unwrap_err();
        assert!(matches!(err, ConfigError::TokenMissing));
    }

    #[test]
    fn token_of_31_chars_is_too_short() {
        let t = "a".repeat(31);
        let err = cfg(&[("AI_BRIDGE_TOKEN", t.as_str())]).unwrap_err();
        assert!(matches!(err, ConfigError::TokenTooShort));
    }

    #[test]
    fn token_of_32_chars_is_accepted() {
        let t = "b".repeat(32);
        let cfg = cfg(&[("AI_BRIDGE_TOKEN", t.as_str())]).unwrap();
        assert_eq!(cfg.bearer_token.as_deref(), Some(t.as_str()));
    }

    #[test]
    fn placeholder_tokens_are_rejected() {
        for t in ["change-me", "CHANGEME", "  Replace-Me  "] {
            let err = cfg(&[("AI_BRIDGE_TOKEN", t)]).unwrap_err();
            assert!(
                matches!(err, ConfigError::TokenPlaceholder),
                "token {t:?} should be a placeholder"
            );
        }
    }

    #[test]
    fn generate_template_token_is_rejected_as_placeholder() {
        let err = cfg(&[("AI_BRIDGE_TOKEN", "<generate: openssl rand -hex 32>")]).unwrap_err();
        assert!(matches!(err, ConfigError::TokenPlaceholder));
    }

    #[test]
    fn defaults_are_applied() {
        let cfg = cfg(&[]).unwrap();
        assert_eq!(cfg.max_concurrency, 2);
        assert_eq!(cfg.statusline_max_age_secs, 900);
        assert_eq!(
            cfg.agy_brain_root,
            Some(PathBuf::from("/Users/test/.gemini/antigravity-cli/brain"))
        );
        assert_eq!(
            cfg.workdir,
            PathBuf::from("/Users/test/Library/Application Support/career-os-ai-bridge/work")
        );
    }

    #[test]
    fn workdir_override_wins_over_home() {
        let cfg = cfg(&[("AI_BRIDGE_WORKDIR", "/tmp/x")]).unwrap();
        assert_eq!(cfg.workdir, PathBuf::from("/tmp/x"));
    }

    #[test]
    fn no_home_and_no_workdir_is_unresolvable() {
        let err = BridgeConfig::from_lookup(lookup(&[("AI_BRIDGE_TOKEN", TOKEN)])).unwrap_err();
        assert!(matches!(err, ConfigError::WorkdirUnresolvable));
    }

    #[test]
    fn max_concurrency_zero_is_invalid() {
        let err = cfg(&[("AI_BRIDGE_MAX_CONCURRENCY", "0")]).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                var: "AI_BRIDGE_MAX_CONCURRENCY",
                ..
            }
        ));
    }

    #[test]
    fn max_concurrency_unparseable_is_invalid() {
        let err = cfg(&[("AI_BRIDGE_MAX_CONCURRENCY", "abc")]).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                var: "AI_BRIDGE_MAX_CONCURRENCY",
                ..
            }
        ));
    }

    #[test]
    fn max_concurrency_parses_valid_value() {
        let cfg = cfg(&[("AI_BRIDGE_MAX_CONCURRENCY", "4")]).unwrap();
        assert_eq!(cfg.max_concurrency, 4);
    }

    #[test]
    fn statusline_max_age_unparseable_is_invalid() {
        let err = cfg(&[("AI_BRIDGE_STATUSLINE_MAX_AGE_SECS", "abc")]).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                var: "AI_BRIDGE_STATUSLINE_MAX_AGE_SECS",
                ..
            }
        ));
    }

    #[test]
    fn statusline_max_age_zero_is_allowed() {
        let cfg = cfg(&[("AI_BRIDGE_STATUSLINE_MAX_AGE_SECS", "0")]).unwrap();
        assert_eq!(cfg.statusline_max_age_secs, 0);
    }

    #[test]
    fn existing_vars_still_work() {
        let cfg = cfg(&[("AI_BRIDGE_PRIMARY", "agy")]).unwrap();
        assert_eq!(cfg.primary_provider, CliProviderKind::Agy);
    }
}
