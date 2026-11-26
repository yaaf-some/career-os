use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind_addr: String,
    pub database_url: String,
    pub static_dir: Option<String>,
    pub allowed_tailscale_user: Option<String>,
    pub exempt_local_google_callback: bool,
    pub token_encryption_key: Option<String>,
    pub ai_bridge_url: Option<String>,
    pub ai_bridge_token: Option<String>,
    pub ai_demo_mode: bool,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub google_redirect_uri: Option<String>,
    pub linear_api_key: Option<String>,
    pub linear_team_id: Option<String>,
    pub cors_origin: Option<String>,
    pub scheduler_enabled: bool,
    pub profile_summary: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:3000".to_string(),
            database_url: "sqlite://./data/career-os.db".to_string(),
            static_dir: None,
            allowed_tailscale_user: None,
            exempt_local_google_callback: true,
            token_encryption_key: None,
            ai_bridge_url: None,
            ai_bridge_token: None,
            ai_demo_mode: false,
            google_client_id: None,
            google_client_secret: None,
            google_redirect_uri: None,
            linear_api_key: None,
            linear_team_id: None,
            cors_origin: None,
            scheduler_enabled: true,
            profile_summary: None,
        }
    }
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            bind_addr: env_non_empty("CAREER_OS_BIND")
                .unwrap_or_else(|| "127.0.0.1:3000".to_string()),
            database_url: env_non_empty("DATABASE_URL")
                .unwrap_or_else(|| "sqlite://./data/career-os.db".to_string()),
            static_dir: env_non_empty("STATIC_DIR"),
            allowed_tailscale_user: env_non_empty("ALLOWED_TAILSCALE_USER"),
            exempt_local_google_callback: env_bool("EXEMPT_LOCAL_GOOGLE_CALLBACK", true),
            token_encryption_key: env_non_empty("CAREER_OS_TOKEN_KEY"),
            ai_bridge_url: env_non_empty("AI_BRIDGE_URL"),
            ai_bridge_token: env_non_empty("AI_BRIDGE_TOKEN"),
            ai_demo_mode: env_bool("AI_DEMO_MODE", false),
            google_client_id: env_non_empty("GOOGLE_CLIENT_ID"),
            google_client_secret: env_non_empty("GOOGLE_CLIENT_SECRET"),
            google_redirect_uri: env_non_empty("GOOGLE_REDIRECT_URI"),
            linear_api_key: env_non_empty("LINEAR_API_KEY"),
            linear_team_id: env_non_empty("LINEAR_TEAM_ID"),
            cors_origin: env_non_empty("CAREER_OS_CORS_ORIGIN"),
            scheduler_enabled: env_bool("CAREER_OS_SCHEDULER_ENABLED", true),
            profile_summary: env_non_empty("CAREER_OS_PROFILE_SUMMARY"),
        }
    }
}

fn env_non_empty(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => match v.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        },
        Err(_) => default,
    }
}
