use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

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

/// One Claude subscription window as written by Claude Code's statusline JSON.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RateWindow {
    /// 0–100.
    pub used_percentage: Option<f64>,
    /// Unix seconds.
    pub resets_at: Option<i64>,
}

/// Typed Claude usage for `/v1/usage`. Only the rate-limit windows leave the bridge:
/// the raw statusline also carries cwd/workspace paths, which stay on the host.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClaudeUsage {
    pub five_hour: Option<RateWindow>,
    pub seven_day: Option<RateWindow>,
    /// Statusline file mtime, unix seconds.
    pub statusline_updated_at: Option<i64>,
    /// No readable file, or older than `AI_BRIDGE_STATUSLINE_MAX_AGE_SECS`.
    pub stale: bool,
}

fn parse_window(v: Option<&serde_json::Value>) -> Option<RateWindow> {
    let obj = v?.as_object()?;
    let w = RateWindow {
        used_percentage: obj.get("used_percentage").and_then(|x| x.as_f64()),
        resets_at: obj
            .get("resets_at")
            .and_then(|x| x.as_f64())
            .filter(|f| f.is_finite())
            .map(|f| f as i64),
    };
    (w.used_percentage.is_some() || w.resets_at.is_some()).then_some(w)
}

/// Pure: builds the typed view from file contents + mtime.
pub fn claude_usage_from(
    contents: Option<&str>,
    mtime: Option<SystemTime>,
    now: SystemTime,
    max_age_secs: u64,
) -> ClaudeUsage {
    let parsed = contents.and_then(|c| match parse_statusline_json(c) {
        Ok(p) => Some(p),
        Err(err) => {
            tracing::warn!(error = %err, "failed parsing Claude statusline JSON");
            None
        }
    });
    let limits = parsed.as_ref().and_then(|p| p.rate_limits.as_ref());
    let updated_at = mtime
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    let fresh = parsed.is_some()
        && mtime
            .map(|t| {
                // A future mtime (clock skew) counts as fresh.
                now.duration_since(t).unwrap_or_default() <= Duration::from_secs(max_age_secs)
            })
            .unwrap_or(false);
    ClaudeUsage {
        five_hour: parse_window(limits.and_then(|l| l.get("five_hour"))),
        seven_day: parse_window(limits.and_then(|l| l.get("seven_day"))),
        statusline_updated_at: updated_at,
        stale: !fresh,
    }
}

pub async fn read_claude_usage(path: &Path, max_age_secs: u64) -> ClaudeUsage {
    let contents = tokio::fs::read_to_string(path).await.ok();
    let mtime = tokio::fs::metadata(path)
        .await
        .ok()
        .and_then(|m| m.modified().ok());
    claude_usage_from(contents.as_deref(), mtime, SystemTime::now(), max_age_secs)
}

/// Resolves a CLI the way `Command::new` would: a path containing `/` is checked
/// directly, a bare name is searched in `path_env`. True if an executable file exists.
pub fn cli_available(bin: &str, path_env: Option<&str>) -> bool {
    fn is_exec(p: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    if bin.is_empty() {
        return false;
    }
    if bin.contains('/') {
        return is_exec(Path::new(bin));
    }
    path_env
        .map(|paths| std::env::split_paths(paths).any(|dir| is_exec(&dir.join(bin))))
        .unwrap_or(false)
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

    const FIXTURE: &str = include_str!("../tests/fixtures/claude_statusline.json");

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    #[test]
    fn typed_windows_from_fixture() {
        let u = claude_usage_from(Some(FIXTURE), Some(at(1_000)), at(1_100), 900);
        assert_eq!(
            u.five_hour,
            Some(RateWindow {
                used_percentage: Some(23.5),
                resets_at: Some(1_790_000_000)
            })
        );
        assert_eq!(
            u.seven_day,
            Some(RateWindow {
                used_percentage: Some(61.0),
                resets_at: Some(1_790_400_000)
            })
        );
        assert_eq!(u.statusline_updated_at, Some(1_000));
        assert!(!u.stale);
        // Raw statusline fields (cwd etc.) are not part of the typed view.
        let json = serde_json::to_string(&u).unwrap();
        assert!(!json.contains("your-user"), "{json}");
    }

    #[test]
    fn old_file_is_stale() {
        let u = claude_usage_from(Some(FIXTURE), Some(at(1_000)), at(1_901), 900);
        assert!(u.stale);
        assert!(u.five_hour.is_some(), "stale data is still reported");
    }

    #[test]
    fn missing_file_is_stale_and_empty() {
        let u = claude_usage_from(None, None, at(1_000), 900);
        assert_eq!(
            u,
            ClaudeUsage {
                five_hour: None,
                seven_day: None,
                statusline_updated_at: None,
                stale: true
            }
        );
    }

    #[test]
    fn malformed_file_is_stale_without_windows() {
        let u = claude_usage_from(Some("{not json"), Some(at(1_000)), at(1_000), 900);
        assert!(u.stale);
        assert_eq!(u.five_hour, None);
        assert_eq!(u.statusline_updated_at, Some(1_000));
    }

    #[test]
    fn no_rate_limits_or_junk_windows() {
        let u = claude_usage_from(Some(r#"{"model":{"id":"x"}}"#), Some(at(5)), at(5), 900);
        assert!(!u.stale);
        assert_eq!((u.five_hour, u.seven_day), (None, None));
        let u = claude_usage_from(
            Some(r#"{"rate_limits":{"five_hour":"x","seven_day":{"used_percentage":"high"}}}"#),
            Some(at(5)),
            at(5),
            900,
        );
        assert_eq!((u.five_hour, u.seven_day), (None, None));
    }

    #[tokio::test]
    async fn reads_file_mtime() {
        let dir = std::env::temp_dir().join(format!("career-os-usage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("statusline.json");
        std::fs::write(&p, FIXTURE).unwrap();
        let u = read_claude_usage(&p, 900).await;
        assert!(!u.stale);
        assert!(u.statusline_updated_at.is_some());
        let missing = read_claude_usage(&dir.join("nope.json"), 900).await;
        assert!(missing.stale);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cli_availability() {
        assert!(cli_available("sh", Some("/usr/bin:/bin")));
        assert!(cli_available("/bin/sh", None));
        assert!(!cli_available(
            "definitely-not-a-cli-xyz",
            Some("/usr/bin:/bin")
        ));
        assert!(!cli_available("sh", None));
        assert!(!cli_available("/etc/hosts", None), "not executable");
        assert!(!cli_available("", Some("/bin")));
    }
}
