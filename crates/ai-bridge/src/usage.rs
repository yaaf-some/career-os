use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClaudeStatusline {
    pub model: Option<StatuslineModel>,
    pub cost: Option<StatuslineCost>,
    pub context_window: Option<StatuslineContextWindow>,
    pub rate_limits: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatuslineModel {
    pub id: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatuslineCost {
    pub total_cost_usd: Option<f64>,
    pub total_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatuslineContextWindow {
    pub total_input_tokens: Option<u64>,
    pub total_output_tokens: Option<u64>,
    pub context_window_size: Option<u64>,
    pub used_percentage: Option<f64>,
}

pub fn parse_statusline_json(raw: &str) -> Result<ClaudeStatusline, serde_json::Error> {
    serde_json::from_str::<ClaudeStatusline>(raw)
}

pub async fn read_statusline_file(path: &Path) -> Option<ClaudeStatusline> {
    let contents = tokio::fs::read_to_string(path).await.ok()?;
    match parse_statusline_json(&contents) {
        Ok(parsed) => Some(parsed),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "failed parsing Claude statusline JSON");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_statusline_json() {
        let raw = r#"{
            "model": { "id": "claude-sonnet-4-5", "display_name": "Sonnet 4.5" },
            "cost": { "total_cost_usd": 0.42, "total_duration_ms": 18200 },
            "context_window": {
                "total_input_tokens": 12000,
                "total_output_tokens": 3400,
                "context_window_size": 200000,
                "used_percentage": 7.7
            }
        }"#;
        let parsed = parse_statusline_json(raw).expect("valid statusline JSON");
        assert_eq!(
            parsed
                .model
                .as_ref()
                .and_then(|m| m.display_name.as_deref()),
            Some("Sonnet 4.5")
        );
        assert_eq!(
            parsed.cost.as_ref().and_then(|c| c.total_cost_usd),
            Some(0.42)
        );
        assert_eq!(
            parsed
                .context_window
                .as_ref()
                .and_then(|w| w.used_percentage),
            Some(7.7)
        );
    }

    #[test]
    fn handles_malformed_statusline_json_gracefully() {
        assert!(parse_statusline_json("{not valid json").is_err());
    }
}
