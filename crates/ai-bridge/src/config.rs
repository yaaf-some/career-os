use std::{env, path::PathBuf};

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
            agy_hydrogen_model: "gemini-2.5-flash-lite".to_string(),
            agy_neon_model: "gemini-2.5-pro".to_string(),
            agy_carbon_model: "gemini-2.5-pro".to_string(),
            default_timeout_secs: 90,
            cooldown_secs: 300,
            claude_statusline_path: None,
        }
    }
}

impl BridgeConfig {
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Some(v) = env_non_empty("AI_BRIDGE_BIND") {
            cfg.bind_addr = v;
        }
        cfg.bearer_token = env_non_empty("AI_BRIDGE_TOKEN");
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
        cfg
    }
}

fn env_non_empty(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
