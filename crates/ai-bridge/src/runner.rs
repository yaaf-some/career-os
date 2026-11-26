use std::{
    future::Future,
    pin::Pin,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tokio::{process::Command, sync::Mutex};

use crate::config::{BridgeConfig, CliProviderKind};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTier {
    Hydrogen,
    Neon,
    Carbon,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CompleteRequest {
    pub tier: AiTier,
    pub system_prompt: Option<String>,
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    #[serde(default)]
    pub json_mode: bool,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteResponse {
    pub content: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub latency_ms: u64,
    pub failover_used: bool,
}

#[derive(Debug, Clone)]
pub struct CliInvokeOutput {
    pub content: String,
    pub model: String,
    pub latency_ms: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum CliInvokeError {
    #[error("rate limited by provider: {0}")]
    RateLimited(String),
    #[error("provider timed out after {0}s")]
    TimedOut(u64),
    #[error("provider exited with error: {0}")]
    ExecutionFailed(String),
}

pub trait CliRunner: Send + Sync {
    fn invoke<'a>(
        &'a self,
        provider: CliProviderKind,
        model: &'a str,
        prompt: &'a str,
        timeout: Duration,
    ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>>;
}

#[derive(Debug, Default, Clone)]
pub struct SystemCliRunner {
    pub claude_bin: String,
    pub agy_bin: String,
}

impl SystemCliRunner {
    pub fn from_config(cfg: &BridgeConfig) -> Self {
        Self {
            claude_bin: cfg.claude_bin.clone(),
            agy_bin: cfg.agy_bin.clone(),
        }
    }
}

impl CliRunner for SystemCliRunner {
    fn invoke<'a>(
        &'a self,
        provider: CliProviderKind,
        model: &'a str,
        prompt: &'a str,
        timeout: Duration,
    ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
        Box::pin(async move {
            let started = Instant::now();
            let bin = match provider {
                CliProviderKind::Claude => &self.claude_bin,
                CliProviderKind::Agy => &self.agy_bin,
            };

            let mut cmd = Command::new(bin);
            cmd.kill_on_drop(true)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            match provider {
                CliProviderKind::Claude => {
                    cmd.args(["-p", prompt, "--model", model, "--output-format", "text"]);
                }
                CliProviderKind::Agy => {
                    cmd.args(["-p", prompt, "--model", model]);
                }
            }

            let output = tokio::time::timeout(timeout, cmd.output())
                .await
                .map_err(|_| CliInvokeError::TimedOut(timeout.as_secs()))?
                .map_err(|e| {
                    CliInvokeError::ExecutionFailed(format!("failed spawning {bin}: {e}"))
                })?;

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            if !output.status.success() {
                let combined = if stderr.is_empty() {
                    stdout.clone()
                } else {
                    stderr.clone()
                };
                if looks_like_rate_limit(&combined) {
                    return Err(CliInvokeError::RateLimited(combined));
                }
                return Err(CliInvokeError::ExecutionFailed(format!(
                    "{bin} exited with {}: {combined}",
                    output.status
                )));
            }

            if stdout.is_empty() && looks_like_rate_limit(&stderr) {
                return Err(CliInvokeError::RateLimited(stderr));
            }

            Ok(CliInvokeOutput {
                content: stdout,
                model: model.to_string(),
                latency_ms: started.elapsed().as_millis() as u64,
            })
        })
    }
}

pub fn looks_like_rate_limit(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("rate limit")
        || lower.contains("rate_limit")
        || lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("quota exceeded")
        || lower.contains("usage limit")
        || lower.contains("overloaded")
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ProviderRuntimeStats {
    pub requests: u64,
    pub failures: u64,
    pub rate_limits: u64,
    pub cooldown_remaining_secs: u64,
}

#[derive(Debug, Default)]
pub struct RuntimeMetrics {
    pub total_requests: u64,
    pub total_failovers: u64,
    pub rate_limit_hits: u64,
    pub claude_requests: u64,
    pub claude_failures: u64,
    pub claude_rate_limits: u64,
    pub claude_cooldown_until: Option<Instant>,
    pub agy_requests: u64,
    pub agy_failures: u64,
    pub agy_rate_limits: u64,
    pub agy_cooldown_until: Option<Instant>,
}

impl RuntimeMetrics {
    pub fn is_on_cooldown(&self, provider: CliProviderKind, now: Instant) -> bool {
        let until = match provider {
            CliProviderKind::Claude => self.claude_cooldown_until,
            CliProviderKind::Agy => self.agy_cooldown_until,
        };
        until.map(|t| t > now).unwrap_or(false)
    }

    pub fn set_cooldown(&mut self, provider: CliProviderKind, now: Instant, secs: u64) {
        let until = Some(now + Duration::from_secs(secs));
        match provider {
            CliProviderKind::Claude => self.claude_cooldown_until = until,
            CliProviderKind::Agy => self.agy_cooldown_until = until,
        }
    }

    pub fn record_attempt(&mut self, provider: CliProviderKind, result: &Result<CliInvokeOutput, CliInvokeError>, now: Instant, cooldown_secs: u64) {
        match provider {
            CliProviderKind::Claude => self.claude_requests += 1,
            CliProviderKind::Agy => self.agy_requests += 1,
        }
        match result {
            Ok(_) => {}
            Err(CliInvokeError::RateLimited(_)) => {
                self.rate_limit_hits += 1;
                match provider {
                    CliProviderKind::Claude => {
                        self.claude_failures += 1;
                        self.claude_rate_limits += 1;
                    }
                    CliProviderKind::Agy => {
                        self.agy_failures += 1;
                        self.agy_rate_limits += 1;
                    }
                }
                self.set_cooldown(provider, now, cooldown_secs);
            }
            Err(_) => match provider {
                CliProviderKind::Claude => self.claude_failures += 1,
                CliProviderKind::Agy => self.agy_failures += 1,
            },
        }
    }

    pub fn snapshot(&self, now: Instant) -> serde_json::Value {
        let rem = |until: Option<Instant>| -> u64 {
            until
                .and_then(|t| t.checked_duration_since(now))
                .map(|d| d.as_secs())
                .unwrap_or(0)
        };
        serde_json::json!({
            "total_requests": self.total_requests,
            "total_failovers": self.total_failovers,
            "rate_limit_hits": self.rate_limit_hits,
            "providers": {
                "claude": ProviderRuntimeStats {
                    requests: self.claude_requests,
                    failures: self.claude_failures,
                    rate_limits: self.claude_rate_limits,
                    cooldown_remaining_secs: rem(self.claude_cooldown_until),
                },
                "agy": ProviderRuntimeStats {
                    requests: self.agy_requests,
                    failures: self.agy_failures,
                    rate_limits: self.agy_rate_limits,
                    cooldown_remaining_secs: rem(self.agy_cooldown_until),
                }
            }
        })
    }
}

pub struct BridgeRouter {
    pub config: BridgeConfig,
    pub runner: Arc<dyn CliRunner>,
    pub metrics: Mutex<RuntimeMetrics>,
}

impl BridgeRouter {
    pub fn new(config: BridgeConfig, runner: Arc<dyn CliRunner>) -> Self {
        Self {
            config,
            runner,
            metrics: Mutex::new(RuntimeMetrics::default()),
        }
    }

    pub fn model_for(&self, provider: CliProviderKind, tier: AiTier) -> &str {
        match (provider, tier) {
            (CliProviderKind::Claude, AiTier::Hydrogen) => &self.config.claude_hydrogen_model,
            (CliProviderKind::Claude, AiTier::Neon) => &self.config.claude_neon_model,
            (CliProviderKind::Claude, AiTier::Carbon) => &self.config.claude_carbon_model,
            (CliProviderKind::Agy, AiTier::Hydrogen) => &self.config.agy_hydrogen_model,
            (CliProviderKind::Agy, AiTier::Neon) => &self.config.agy_neon_model,
            (CliProviderKind::Agy, AiTier::Carbon) => &self.config.agy_carbon_model,
        }
    }

    pub async fn complete(&self, req: CompleteRequest) -> Result<CompleteResponse, CliInvokeError> {
        let combined_prompt = match &req.system_prompt {
            Some(sys) if !sys.trim().is_empty() => {
                format!("SYSTEM:\n{}\n\nUSER:\n{}", sys.trim(), req.prompt)
            }
            _ => req.prompt.clone(),
        };

        let timeout = Duration::from_secs(
            req.timeout_secs
                .unwrap_or(self.config.default_timeout_secs)
                .clamp(5, 300),
        );

        let primary = self.config.primary_provider;
        let secondary = primary.other();
        let now = Instant::now();

        let order = {
            let mut m = self.metrics.lock().await;
            m.total_requests += 1;
            let primary_cooled = m.is_on_cooldown(primary, now);
            let secondary_cooled = m.is_on_cooldown(secondary, now);
            if primary_cooled && !secondary_cooled {
                vec![secondary, primary]
            } else {
                vec![primary, secondary]
            }
        };

        let mut last_err = None;
        for (idx, provider) in order.iter().copied().enumerate() {
            let model = self.model_for(provider, req.tier);
            let res = self
                .runner
                .invoke(provider, model, &combined_prompt, timeout)
                .await;

            {
                let mut m = self.metrics.lock().await;
                m.record_attempt(provider, &res, Instant::now(), self.config.cooldown_secs);
                if idx > 0 && res.is_ok() {
                    m.total_failovers += 1;
                }
            }

            match res {
                Ok(out) => {
                    return Ok(CompleteResponse {
                        content: out.content,
                        provider: provider.as_str().to_string(),
                        model: out.model,
                        prompt_tokens: None,
                        completion_tokens: None,
                        latency_ms: out.latency_ms,
                        failover_used: idx > 0 || provider != primary,
                    });
                }
                Err(err) => {
                    tracing::warn!(
                        provider = provider.as_str(),
                        error = %err,
                        "CLI provider attempt failed"
                    );
                    last_err = Some(err);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            CliInvokeError::ExecutionFailed("no CLI providers available".to_string())
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct ScriptedRunner {
        claude_results: Mutex<VecDeque<Result<CliInvokeOutput, CliInvokeError>>>,
        agy_results: Mutex<VecDeque<Result<CliInvokeOutput, CliInvokeError>>>,
    }

    impl CliRunner for ScriptedRunner {
        fn invoke<'a>(
            &'a self,
            provider: CliProviderKind,
            model: &'a str,
            _prompt: &'a str,
            _timeout: Duration,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            Box::pin(async move {
                let queue = match provider {
                    CliProviderKind::Claude => &self.claude_results,
                    CliProviderKind::Agy => &self.agy_results,
                };
                let mut guard = queue.lock().await;
                guard.pop_front().unwrap_or_else(|| {
                    Ok(CliInvokeOutput {
                        content: format!("ok from {} ({model})", provider.as_str()),
                        model: model.to_string(),
                        latency_ms: 12,
                    })
                })
            })
        }
    }

    #[tokio::test]
    async fn failover_on_rate_limit_and_cooldown_routing() {
        let runner = Arc::new(ScriptedRunner {
            claude_results: Mutex::new(VecDeque::from([
                Err(CliInvokeError::RateLimited("429 rate limit".to_string())),
            ])),
            agy_results: Mutex::new(VecDeque::from([
                Ok(CliInvokeOutput {
                    content: "agy fallback ok".to_string(),
                    model: "gemini-2.5-flash-lite".to_string(),
                    latency_ms: 15,
                }),
                Ok(CliInvokeOutput {
                    content: "agy direct during cooldown".to_string(),
                    model: "gemini-2.5-pro".to_string(),
                    latency_ms: 10,
                }),
            ])),
        });

        let cfg = BridgeConfig {
            primary_provider: CliProviderKind::Claude,
            cooldown_secs: 120,
            ..BridgeConfig::default()
        };
        let router = BridgeRouter::new(cfg, runner);

        // First request hits Claude 429 -> fails over to Agy and sets Claude cooldown
        let r1 = router
            .complete(CompleteRequest {
                tier: AiTier::Hydrogen,
                system_prompt: None,
                prompt: "score".to_string(),
                max_tokens: None,
                temperature: None,
                json_mode: true,
                timeout_secs: Some(15),
            })
            .await
            .expect("failover succeeds");
        assert_eq!(r1.provider, "agy");
        assert!(r1.failover_used);
        assert_eq!(r1.model, "gemini-2.5-flash-lite");

        // Second request skips cooled-down Claude and routes directly to Agy
        let r2 = router
            .complete(CompleteRequest {
                tier: AiTier::Neon,
                system_prompt: None,
                prompt: "evaluate".to_string(),
                max_tokens: None,
                temperature: None,
                json_mode: true,
                timeout_secs: Some(15),
            })
            .await
            .expect("cooldown routes to agy");
        assert_eq!(r2.provider, "agy");
        assert_eq!(r2.content, "agy direct during cooldown");

        let snap = router.metrics.lock().await.snapshot(Instant::now());
        assert_eq!(snap["rate_limit_hits"], 1);
        assert_eq!(snap["total_failovers"], 1);
        assert_eq!(snap["providers"]["claude"]["requests"], 1);
        assert_eq!(snap["providers"]["agy"]["requests"], 2);
    }
}
