use std::{
    future::Future,
    path::PathBuf,
    pin::Pin,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{Mutex, Semaphore},
};

pub use crate::cli::{looks_like_rate_limit, InvokeRequest};
use crate::{
    cli::{
        build_command_spec, compose_system_prompt, parse_agy_line, parse_claude_output,
        remove_agy_conversation, write_private_file, AgyEvent, CommandSpec, ParsedOutput,
    },
    config::{BridgeConfig, CliProviderKind, RoutingMode},
};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTier {
    #[serde(alias = "hydrogen")]
    Fast,
    #[serde(alias = "neon")]
    Balanced,
    #[serde(alias = "carbon")]
    Deep,
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
    /// Overrides `AI_BRIDGE_ROUTING_MODE` / `AI_BRIDGE_PRIMARY` for this request.
    #[serde(default)]
    pub routing_mode: Option<RoutingMode>,
    /// Legacy per-provider override; superseded by `routing_mode`.
    #[serde(default)]
    pub primary: Option<CliProviderKind>,
    /// When false, only the primary is tried (no failover, even on rate limit).
    #[serde(default = "default_true")]
    pub allow_failover: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteResponse {
    pub content: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub cost_usd: Option<f64>,
    pub latency_ms: u64,
    pub failover_used: bool,
}

#[derive(Debug, Clone)]
pub struct CliInvokeOutput {
    pub content: String,
    pub model: String,
    pub latency_ms: u64,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, thiserror::Error)]
pub enum CliInvokeError {
    #[error("rate limited by provider: {0}")]
    RateLimited(String),
    #[error("provider timed out after {0}s")]
    TimedOut(u64),
    #[error("provider exited with error: {0}")]
    ExecutionFailed(String),
    #[error("provider unavailable: {0}")]
    Unavailable(String),
    #[error("provider attempted tool use ({0}); run aborted")]
    ToolUseAttempted(String),
}

impl CliInvokeError {
    /// Errors that say "this provider can't serve now", not "this request is bad".
    /// Generic non-zero exits are excluded: retrying them elsewhere doubles wall time
    /// for what is usually a prompt/response problem.
    pub fn is_failover_eligible(&self) -> bool {
        matches!(
            self,
            Self::RateLimited(_)
                | Self::TimedOut(_)
                | Self::Unavailable(_)
                | Self::ToolUseAttempted(_)
        )
    }
}

/// Errors returned by `BridgeRouter::complete`.
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error(transparent)]
    Upstream(#[from] CliInvokeError),
    #[error("bridge busy: no free slot within {0}s")]
    Busy(u64),
}

impl BridgeError {
    /// HTTP status and stable error code for the JSON error body.
    pub fn status_and_code(&self) -> (u16, &'static str) {
        match self {
            Self::Busy(_) => (503, "BRIDGE_BUSY"),
            Self::Upstream(e) => match e {
                CliInvokeError::RateLimited(_) => (429, "RATE_LIMITED"),
                CliInvokeError::TimedOut(_) => (504, "TIMED_OUT"),
                CliInvokeError::ExecutionFailed(_) => (502, "UPSTREAM_FAILED"),
                CliInvokeError::ToolUseAttempted(_) => (502, "TOOL_USE_BLOCKED"),
                CliInvokeError::Unavailable(_) => (503, "PROVIDER_UNAVAILABLE"),
            },
        }
    }
}

pub trait CliRunner: Send + Sync {
    fn invoke<'a>(
        &'a self,
        req: InvokeRequest<'a>,
    ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>>;
}

const MAX_STDOUT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: u64 = 64 * 1024;
const REAP_GRACE: Duration = Duration::from_secs(5);

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
pub struct SystemCliRunner {
    pub claude_bin: String,
    pub agy_bin: String,
    pub workdir: PathBuf,
    pub agy_brain_root: Option<PathBuf>,
}

impl SystemCliRunner {
    pub fn from_config(cfg: &BridgeConfig) -> Self {
        Self {
            claude_bin: cfg.claude_bin.clone(),
            agy_bin: cfg.agy_bin.clone(),
            workdir: cfg.workdir.clone(),
            agy_brain_root: cfg.agy_brain_root.clone(),
        }
    }

    async fn run(&self, req: InvokeRequest<'_>) -> Result<ParsedOutput, CliInvokeError> {
        let bin = match req.provider {
            CliProviderKind::Claude => &self.claude_bin,
            CliProviderKind::Agy => &self.agy_bin,
        };
        let run_id = format!(
            "{}-{}",
            std::process::id(),
            RUN_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let spec = build_command_spec(&req, bin, &self.workdir, &run_id, |k| std::env::var(k).ok());

        if let Some(tf) = &spec.temp_file {
            write_private_file(&tf.path, &tf.contents).map_err(|e| {
                CliInvokeError::Unavailable(format!("cannot write system prompt file: {e}"))
            })?;
        }
        let result = self.spawn_and_collect(&spec, req).await;
        if let Some(tf) = &spec.temp_file {
            let _ = std::fs::remove_file(&tf.path);
        }
        result
    }

    async fn spawn_and_collect(
        &self,
        spec: &CommandSpec,
        req: InvokeRequest<'_>,
    ) -> Result<ParsedOutput, CliInvokeError> {
        let deadline = tokio::time::Instant::now() + req.timeout;
        let mut child = Command::new(&spec.program)
            .args(&spec.args)
            .env_clear()
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                CliInvokeError::Unavailable(format!("cannot start {}: {e}", spec.program))
            })?;

        // Feed stdin and drain stderr concurrently so large prompts can't deadlock the pipes.
        let mut stdin = child.stdin.take().expect("stdin piped");
        let input = spec.stdin.clone().into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&input).await;
            let _ = stdin.shutdown().await;
        });
        let stderr_task = tokio::spawn(read_capped(
            child.stderr.take().expect("stderr piped"),
            MAX_STDERR_BYTES,
        ));
        let stdout = child.stdout.take().expect("stdout piped");

        match req.provider {
            CliProviderKind::Claude => {
                let out =
                    tokio::time::timeout_at(deadline, read_capped(stdout, MAX_STDOUT_BYTES)).await;
                let Ok(out) = out else {
                    kill(&mut child).await;
                    return Err(CliInvokeError::TimedOut(req.timeout.as_secs()));
                };
                let status = reap(&mut child).await;
                let stderr = join_stderr(stderr_task).await;
                parse_claude_output(&out, &stderr, status.unwrap_or(false))
            }
            CliProviderKind::Agy => {
                let mut conversation: Option<String> = None;
                let mut outcome: Option<Result<ParsedOutput, CliInvokeError>> = None;
                let mut lines = BufReader::new(stdout.take(MAX_STDOUT_BYTES)).lines();
                loop {
                    match tokio::time::timeout_at(deadline, lines.next_line()).await {
                        Err(_) => {
                            outcome = Some(Err(CliInvokeError::TimedOut(req.timeout.as_secs())));
                            break;
                        }
                        Ok(Ok(Some(line))) => match parse_agy_line(&line) {
                            AgyEvent::Init { conversation_id } => {
                                conversation = conversation.or(conversation_id);
                            }
                            AgyEvent::ToolStep { tool } => {
                                tracing::warn!(tool = %tool, "agy attempted tool use; killing run");
                                outcome = Some(Err(CliInvokeError::ToolUseAttempted(tool)));
                                break;
                            }
                            AgyEvent::Result {
                                conversation_id,
                                outcome: o,
                            } => {
                                conversation = conversation.or(conversation_id);
                                outcome = Some(o);
                                break;
                            }
                            AgyEvent::Other => {}
                        },
                        Ok(Ok(None)) | Ok(Err(_)) => break,
                    }
                }
                let finished_cleanly = matches!(
                    outcome,
                    Some(Ok(_))
                        | Some(Err(CliInvokeError::ExecutionFailed(_)))
                        | Some(Err(CliInvokeError::RateLimited(_)))
                );
                if finished_cleanly {
                    let _ = reap(&mut child).await;
                } else {
                    kill(&mut child).await;
                }
                let stderr = join_stderr(stderr_task).await;

                // Cleanup runs on every path (success, error, tool kill, timeout).
                if let (Some(root), Some(id)) = (&self.agy_brain_root, &conversation) {
                    if let Err(e) = remove_agy_conversation(root, id) {
                        tracing::warn!(error = %e, "failed to remove agy conversation");
                    }
                }

                outcome.unwrap_or_else(|| {
                    let msg = if stderr.trim().is_empty() {
                        "agy exited without a result".to_string()
                    } else {
                        stderr.trim().chars().take(500).collect()
                    };
                    Err(if looks_like_rate_limit(&stderr) {
                        CliInvokeError::RateLimited(msg)
                    } else {
                        CliInvokeError::ExecutionFailed(msg)
                    })
                })
            }
        }
    }
}

/// Reads up to `cap` bytes, then keeps draining (discarding) so the child never blocks on a full pipe.
async fn read_capped<R: AsyncRead + Unpin>(mut r: R, cap: u64) -> String {
    let mut buf = Vec::new();
    let _ = (&mut r).take(cap).read_to_end(&mut buf).await;
    let _ = tokio::io::copy(&mut r, &mut tokio::io::sink()).await;
    String::from_utf8_lossy(&buf).into_owned()
}

/// A killed CLI's grandchildren may keep stderr open; don't wait on them.
async fn join_stderr(task: tokio::task::JoinHandle<String>) -> String {
    match tokio::time::timeout(REAP_GRACE, task).await {
        Ok(Ok(s)) => s,
        _ => String::new(),
    }
}

async fn kill(child: &mut Child) {
    let _ = child.start_kill();
    let _ = tokio::time::timeout(REAP_GRACE, child.wait()).await;
}

/// Waits briefly for exit; kills if the child lingers. Returns success, if known.
async fn reap(child: &mut Child) -> Option<bool> {
    match tokio::time::timeout(REAP_GRACE, child.wait()).await {
        Ok(Ok(status)) => Some(status.success()),
        _ => {
            kill(child).await;
            None
        }
    }
}

impl CliRunner for SystemCliRunner {
    fn invoke<'a>(
        &'a self,
        req: InvokeRequest<'a>,
    ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
        Box::pin(async move {
            let started = Instant::now();
            let out = self.run(req).await?;
            Ok(CliInvokeOutput {
                content: out.content,
                model: req.model.to_string(),
                latency_ms: started.elapsed().as_millis() as u64,
                prompt_tokens: out.prompt_tokens,
                completion_tokens: out.completion_tokens,
                cost_usd: out.cost_usd,
            })
        })
    }
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
    pub busy_rejections: u64,
    pub auto_rr_cursor: u64,
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

    pub fn record_attempt(
        &mut self,
        provider: CliProviderKind,
        result: &Result<CliInvokeOutput, CliInvokeError>,
        now: Instant,
        cooldown_secs: u64,
    ) {
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
            "busy_rejections": self.busy_rejections,
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
    slots: Semaphore,
}

impl BridgeRouter {
    pub fn new(config: BridgeConfig, runner: Arc<dyn CliRunner>) -> Self {
        let slots = Semaphore::new(config.max_concurrency.max(1));
        Self {
            config,
            runner,
            metrics: Mutex::new(RuntimeMetrics::default()),
            slots,
        }
    }

    pub fn model_for(&self, provider: CliProviderKind, tier: AiTier) -> &str {
        match (provider, tier) {
            (CliProviderKind::Claude, AiTier::Fast) => &self.config.claude_fast_model,
            (CliProviderKind::Claude, AiTier::Balanced) => &self.config.claude_balanced_model,
            (CliProviderKind::Claude, AiTier::Deep) => &self.config.claude_deep_model,
            (CliProviderKind::Agy, AiTier::Fast) => &self.config.agy_fast_model,
            (CliProviderKind::Agy, AiTier::Balanced) => &self.config.agy_balanced_model,
            (CliProviderKind::Agy, AiTier::Deep) => &self.config.agy_deep_model,
        }
    }

    async fn claude_quota_high(&self) -> bool {
        let Some(path) = &self.config.claude_statusline_path else {
            return false;
        };
        let usage =
            crate::usage::read_claude_usage(path, self.config.statusline_max_age_secs).await;
        if usage.stale {
            return false;
        }
        let threshold = self.config.claude_high_usage_threshold_pct;
        let five_high = usage
            .five_hour
            .and_then(|w| w.used_percentage)
            .is_some_and(|p| p >= threshold);
        let seven_high = usage
            .seven_day
            .and_then(|w| w.used_percentage)
            .is_some_and(|p| p >= threshold);
        five_high || seven_high
    }

    pub async fn complete(&self, req: CompleteRequest) -> Result<CompleteResponse, BridgeError> {
        let timeout = Duration::from_secs(
            req.timeout_secs
                .unwrap_or(self.config.default_timeout_secs)
                .clamp(5, 300),
        );
        // Waiting for a slot counts toward the first attempt's timeout.
        let deadline = tokio::time::Instant::now() + timeout;

        self.metrics.lock().await.total_requests += 1;

        let permit = tokio::time::timeout_at(deadline, self.slots.acquire()).await;
        let first_timeout = deadline.saturating_duration_since(tokio::time::Instant::now());
        let _permit = match permit {
            Ok(Ok(p)) if first_timeout >= Duration::from_secs(1) => p,
            _ => {
                self.metrics.lock().await.busy_rejections += 1;
                return Err(BridgeError::Busy(timeout.as_secs()));
            }
        };

        let effective_mode = req.routing_mode.unwrap_or(match req.primary {
            Some(CliProviderKind::Claude) => RoutingMode::PreferClaude,
            Some(CliProviderKind::Agy) => RoutingMode::PreferAgy,
            None => self.config.default_routing_mode,
        });
        let quota_high = if effective_mode == RoutingMode::Auto {
            self.claude_quota_high().await
        } else {
            false
        };
        let order = {
            let now = Instant::now();
            let mut m = self.metrics.lock().await;
            let claude_cd = m.is_on_cooldown(CliProviderKind::Claude, now);
            let agy_cd = m.is_on_cooldown(CliProviderKind::Agy, now);
            let (first, second) = match effective_mode {
                RoutingMode::PreferClaude => {
                    if req.allow_failover && claude_cd && !agy_cd {
                        (CliProviderKind::Agy, CliProviderKind::Claude)
                    } else {
                        (CliProviderKind::Claude, CliProviderKind::Agy)
                    }
                }
                RoutingMode::PreferAgy => {
                    if req.allow_failover && agy_cd && !claude_cd {
                        (CliProviderKind::Claude, CliProviderKind::Agy)
                    } else {
                        (CliProviderKind::Agy, CliProviderKind::Claude)
                    }
                }
                RoutingMode::Auto => {
                    if claude_cd && !agy_cd {
                        (CliProviderKind::Agy, CliProviderKind::Claude)
                    } else if agy_cd && !claude_cd {
                        (CliProviderKind::Claude, CliProviderKind::Agy)
                    } else if quota_high {
                        (CliProviderKind::Agy, CliProviderKind::Claude)
                    } else {
                        let pick_claude = m.auto_rr_cursor.is_multiple_of(2);
                        m.auto_rr_cursor = m.auto_rr_cursor.wrapping_add(1);
                        if pick_claude {
                            (CliProviderKind::Claude, CliProviderKind::Agy)
                        } else {
                            (CliProviderKind::Agy, CliProviderKind::Claude)
                        }
                    }
                }
            };
            if req.allow_failover {
                vec![first, second]
            } else {
                vec![first]
            }
        };

        let system_prompt = compose_system_prompt(req.system_prompt.as_deref(), req.json_mode);

        let mut last_err = None;
        for (idx, provider) in order.iter().copied().enumerate() {
            let model = self.model_for(provider, req.tier);
            let res = self
                .runner
                .invoke(InvokeRequest {
                    provider,
                    model,
                    system_prompt: system_prompt.as_deref(),
                    prompt: &req.prompt,
                    // A failover attempt gets the full budget; the API's client timeout
                    // allows 2x + slack when failover is on.
                    timeout: if idx == 0 { first_timeout } else { timeout },
                })
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
                        prompt_tokens: out.prompt_tokens,
                        completion_tokens: out.completion_tokens,
                        cost_usd: out.cost_usd,
                        latency_ms: out.latency_ms,
                        failover_used: idx > 0,
                    });
                }
                Err(err) => {
                    tracing::warn!(
                        provider = provider.as_str(),
                        error = %err,
                        "CLI provider attempt failed"
                    );
                    let eligible = err.is_failover_eligible();
                    last_err = Some(err);
                    if !eligible {
                        break;
                    }
                }
            }
        }

        Err(last_err
            .unwrap_or_else(|| {
                CliInvokeError::ExecutionFailed("no CLI providers available".to_string())
            })
            .into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    type Scripted = Mutex<VecDeque<Result<CliInvokeOutput, CliInvokeError>>>;

    #[derive(Debug, Clone)]
    struct Call {
        provider: CliProviderKind,
        timeout: Duration,
        system_prompt: Option<String>,
    }

    #[derive(Default)]
    struct ScriptedRunner {
        claude_results: Scripted,
        agy_results: Scripted,
        calls: Mutex<Vec<Call>>,
        /// Each invoke sleeps this long first (concurrency tests).
        delay: Duration,
    }

    impl ScriptedRunner {
        fn with(claude: Vec<CliInvokeResult>, agy: Vec<CliInvokeResult>) -> Self {
            Self {
                claude_results: Mutex::new(claude.into()),
                agy_results: Mutex::new(agy.into()),
                ..Self::default()
            }
        }

        async fn providers_called(&self) -> Vec<CliProviderKind> {
            self.calls.lock().await.iter().map(|c| c.provider).collect()
        }
    }

    type CliInvokeResult = Result<CliInvokeOutput, CliInvokeError>;

    fn ok(content: &str, model: &str) -> CliInvokeResult {
        Ok(CliInvokeOutput {
            content: content.to_string(),
            model: model.to_string(),
            latency_ms: 10,
            prompt_tokens: None,
            completion_tokens: None,
            cost_usd: None,
        })
    }

    impl CliRunner for ScriptedRunner {
        fn invoke<'a>(
            &'a self,
            req: InvokeRequest<'a>,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            Box::pin(async move {
                self.calls.lock().await.push(Call {
                    provider: req.provider,
                    timeout: req.timeout,
                    system_prompt: req.system_prompt.map(str::to_string),
                });
                if !self.delay.is_zero() {
                    tokio::time::sleep(self.delay).await;
                }
                let queue = match req.provider {
                    CliProviderKind::Claude => &self.claude_results,
                    CliProviderKind::Agy => &self.agy_results,
                };
                let next = queue.lock().await.pop_front();
                next.unwrap_or_else(|| {
                    ok(
                        &format!("ok from {} ({})", req.provider.as_str(), req.model),
                        req.model,
                    )
                })
            })
        }
    }

    fn creq(tier: AiTier, prompt: &str) -> CompleteRequest {
        CompleteRequest {
            tier,
            system_prompt: None,
            prompt: prompt.to_string(),
            max_tokens: None,
            temperature: None,
            json_mode: false,
            timeout_secs: Some(15),
            routing_mode: None,
            primary: None,
            allow_failover: true,
        }
    }

    fn claude_primary() -> BridgeConfig {
        BridgeConfig {
            primary_provider: CliProviderKind::Claude,
            default_routing_mode: RoutingMode::PreferClaude,
            cooldown_secs: 120,
            ..BridgeConfig::default()
        }
    }

    #[tokio::test]
    async fn failover_on_rate_limit_and_cooldown_routing() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![Err(CliInvokeError::RateLimited("429 rate limit".into()))],
            vec![
                ok("agy fallback ok", "gemini-a"),
                ok("agy direct during cooldown", "gemini-b"),
            ],
        ));
        let router = BridgeRouter::new(claude_primary(), runner);

        // First request hits Claude 429 -> fails over to Agy and sets Claude cooldown
        let r1 = router.complete(creq(AiTier::Fast, "score")).await.unwrap();
        assert_eq!(r1.provider, "agy");
        assert!(r1.failover_used);
        assert_eq!(r1.model, "gemini-a");

        // Second request skips cooled-down Claude and routes directly to Agy
        let r2 = router
            .complete(creq(AiTier::Balanced, "evaluate"))
            .await
            .unwrap();
        assert_eq!(r2.provider, "agy");
        assert_eq!(r2.content, "agy direct during cooldown");

        let snap = router.metrics.lock().await.snapshot(Instant::now());
        assert_eq!(snap["rate_limit_hits"], 1);
        assert_eq!(snap["total_failovers"], 1);
        assert_eq!(snap["providers"]["claude"]["requests"], 1);
        assert_eq!(snap["providers"]["agy"]["requests"], 2);
    }

    #[tokio::test]
    async fn request_primary_overrides_config() {
        let runner = Arc::new(ScriptedRunner::default());
        let router = BridgeRouter::new(claude_primary(), runner.clone());
        let mut r = creq(AiTier::Balanced, "x");
        r.primary = Some(CliProviderKind::Agy);
        let resp = router.complete(r).await.unwrap();
        assert_eq!(resp.provider, "agy");
        assert!(!resp.failover_used);
        assert_eq!(runner.providers_called().await, vec![CliProviderKind::Agy]);
    }

    #[tokio::test]
    async fn allow_failover_false_tries_primary_only() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![Err(CliInvokeError::RateLimited("429".into()))],
            vec![],
        ));
        let router = BridgeRouter::new(claude_primary(), runner.clone());
        let mut r = creq(AiTier::Balanced, "x");
        r.allow_failover = false;
        let err = router.complete(r).await.unwrap_err();
        assert!(matches!(
            err,
            BridgeError::Upstream(CliInvokeError::RateLimited(_))
        ));
        assert_eq!(err.status_and_code(), (429, "RATE_LIMITED"));
        assert_eq!(
            runner.providers_called().await,
            vec![CliProviderKind::Claude]
        );

        // Even with Claude cooling down, failover=false keeps the requested primary.
        let mut r = creq(AiTier::Balanced, "y");
        r.allow_failover = false;
        assert_eq!(router.complete(r).await.unwrap().provider, "claude");
    }

    #[tokio::test]
    async fn generic_exit_failure_does_not_fail_over() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![Err(CliInvokeError::ExecutionFailed("bad output".into()))],
            vec![],
        ));
        let router = BridgeRouter::new(claude_primary(), runner.clone());
        let err = router
            .complete(creq(AiTier::Balanced, "x"))
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code(), (502, "UPSTREAM_FAILED"));
        assert_eq!(
            runner.providers_called().await,
            vec![CliProviderKind::Claude]
        );
    }

    #[tokio::test]
    async fn timeout_and_unavailable_fail_over() {
        for err in [
            CliInvokeError::TimedOut(15),
            CliInvokeError::Unavailable("not found".into()),
        ] {
            let runner = Arc::new(ScriptedRunner::with(vec![Err(err)], vec![]));
            let router = BridgeRouter::new(claude_primary(), runner.clone());
            let resp = router.complete(creq(AiTier::Balanced, "x")).await.unwrap();
            assert_eq!(resp.provider, "agy");
            assert!(resp.failover_used);
            // Only rate limits put a provider on cooldown.
            let m = router.metrics.lock().await;
            assert!(!m.is_on_cooldown(CliProviderKind::Claude, Instant::now()));
        }
    }

    #[tokio::test]
    async fn agy_tool_attempt_fails_over_without_cooldown() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![],
            vec![Err(CliInvokeError::ToolUseAttempted("search_web".into()))],
        ));
        let cfg = BridgeConfig {
            primary_provider: CliProviderKind::Agy,
            default_routing_mode: RoutingMode::PreferAgy,
            ..claude_primary()
        };
        let router = BridgeRouter::new(cfg, runner.clone());
        let resp = router.complete(creq(AiTier::Balanced, "x")).await.unwrap();
        assert_eq!(resp.provider, "claude");
        assert!(resp.failover_used);
        assert!(!router
            .metrics
            .lock()
            .await
            .is_on_cooldown(CliProviderKind::Agy, Instant::now()));
        // Next request still starts with agy.
        router.complete(creq(AiTier::Balanced, "y")).await.unwrap();
        assert_eq!(
            runner.providers_called().await,
            vec![
                CliProviderKind::Agy,
                CliProviderKind::Claude,
                CliProviderKind::Agy
            ]
        );
    }

    #[tokio::test]
    async fn tool_attempt_with_failover_off_maps_to_its_own_code() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![],
            vec![Err(CliInvokeError::ToolUseAttempted("search_web".into()))],
        ));
        let router = BridgeRouter::new(claude_primary(), runner);
        let mut r = creq(AiTier::Balanced, "x");
        r.primary = Some(CliProviderKind::Agy);
        r.allow_failover = false;
        let err = router.complete(r).await.unwrap_err();
        assert_eq!(err.status_and_code(), (502, "TOOL_USE_BLOCKED"));
    }

    #[tokio::test]
    async fn both_failing_returns_last_error() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![Err(CliInvokeError::RateLimited("429".into()))],
            vec![Err(CliInvokeError::TimedOut(15))],
        ));
        let router = BridgeRouter::new(claude_primary(), runner);
        let err = router
            .complete(creq(AiTier::Balanced, "x"))
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code(), (504, "TIMED_OUT"));
    }

    #[tokio::test]
    async fn saturated_bridge_returns_busy_and_wait_counts_toward_timeout() {
        let runner = Arc::new(ScriptedRunner {
            delay: Duration::from_millis(2500),
            ..ScriptedRunner::default()
        });
        let cfg = BridgeConfig {
            max_concurrency: 1,
            ..claude_primary()
        };
        let router = Arc::new(BridgeRouter::new(cfg, runner.clone()));

        let r1 = router.clone();
        let first = tokio::spawn(async move {
            let mut r = creq(AiTier::Balanced, "slow");
            r.timeout_secs = Some(30);
            r1.complete(r).await
        });
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Min timeout is 5 s; the slot frees after ~2.5 s, so this one waits, then runs
        // with the remaining ~2.4 s as its attempt timeout.
        let r2 = router.clone();
        let waiter = tokio::spawn(async move {
            let mut r = creq(AiTier::Balanced, "waits");
            r.timeout_secs = Some(5);
            r2.complete(r).await
        });

        first.await.unwrap().unwrap();
        waiter.await.unwrap().unwrap();
        let calls = runner.calls.lock().await.clone();
        assert_eq!(calls.len(), 2);
        assert!(
            calls[1].timeout < Duration::from_secs(5) && calls[1].timeout > Duration::from_secs(1),
            "wait not deducted: {:?}",
            calls[1].timeout
        );

        // Hold the only slot past a request's whole budget => BRIDGE_BUSY.
        let runner = Arc::new(ScriptedRunner {
            delay: Duration::from_secs(8),
            ..ScriptedRunner::default()
        });
        let cfg = BridgeConfig {
            max_concurrency: 1,
            ..claude_primary()
        };
        let router = Arc::new(BridgeRouter::new(cfg, runner.clone()));
        let r1 = router.clone();
        let hog = tokio::spawn(async move {
            let mut r = creq(AiTier::Balanced, "hog");
            r.timeout_secs = Some(30);
            r1.complete(r).await
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut r = creq(AiTier::Balanced, "rejected");
        r.timeout_secs = Some(5);
        let err = router.complete(r).await.unwrap_err();
        assert!(matches!(err, BridgeError::Busy(5)), "{err:?}");
        assert_eq!(err.status_and_code(), (503, "BRIDGE_BUSY"));
        assert_eq!(runner.calls.lock().await.len(), 1);
        assert_eq!(
            router.metrics.lock().await.snapshot(Instant::now())["busy_rejections"],
            1
        );
        hog.abort();
    }

    #[tokio::test]
    async fn json_mode_adds_instruction_to_system_prompt() {
        let runner = Arc::new(ScriptedRunner::default());
        let router = BridgeRouter::new(claude_primary(), runner.clone());
        let mut r = creq(AiTier::Balanced, "x");
        r.json_mode = true;
        r.system_prompt = Some("Score this job.".into());
        router.complete(r).await.unwrap();
        router
            .complete(creq(AiTier::Balanced, "plain"))
            .await
            .unwrap();
        let calls = runner.calls.lock().await.clone();
        let sys = calls[0].system_prompt.as_deref().unwrap();
        assert!(sys.starts_with("Score this job."));
        assert!(sys.contains(crate::cli::JSON_MODE_INSTRUCTION));
        assert_eq!(calls[1].system_prompt, None);
    }

    #[test]
    fn complete_request_defaults_and_legacy_tier_aliases() {
        let r: CompleteRequest =
            serde_json::from_str(r#"{"tier":"balanced","prompt":"p"}"#).unwrap();
        assert_eq!(r.tier, AiTier::Balanced);
        assert!(r.allow_failover);
        assert_eq!(r.routing_mode, None);
        assert_eq!(r.primary, None);

        for (raw, expected) in [
            ("fast", AiTier::Fast),
            ("balanced", AiTier::Balanced),
            ("deep", AiTier::Deep),
            ("hydrogen", AiTier::Fast),
            ("neon", AiTier::Balanced),
            ("carbon", AiTier::Deep),
        ] {
            let parsed: CompleteRequest =
                serde_json::from_str(&format!(r#"{{"tier":"{raw}","prompt":"p"}}"#)).unwrap();
            assert_eq!(parsed.tier, expected);
        }

        let r: CompleteRequest = serde_json::from_str(
            r#"{"tier":"deep","prompt":"p","routing_mode":"auto","primary":"agy","allow_failover":false}"#,
        )
        .unwrap();
        assert_eq!(r.tier, AiTier::Deep);
        assert_eq!(r.routing_mode, Some(RoutingMode::Auto));
        assert_eq!(r.primary, Some(CliProviderKind::Agy));
        assert!(!r.allow_failover);
        assert!(serde_json::from_str::<CompleteRequest>(
            r#"{"tier":"balanced","prompt":"p","primary":"codex"}"#
        )
        .is_err());
    }

    #[tokio::test]
    async fn auto_mode_balances_claude_and_agy_equally() {
        let runner = Arc::new(ScriptedRunner::default());
        let cfg = BridgeConfig {
            default_routing_mode: RoutingMode::Auto,
            ..BridgeConfig::default()
        };
        let router = BridgeRouter::new(cfg, runner.clone());

        for tier in [AiTier::Fast, AiTier::Balanced, AiTier::Deep, AiTier::Fast] {
            let mut r = creq(tier, "balance");
            r.routing_mode = Some(RoutingMode::Auto);
            let resp = router.complete(r).await.unwrap();
            assert!(!resp.failover_used);
        }

        assert_eq!(
            runner.providers_called().await,
            vec![
                CliProviderKind::Claude,
                CliProviderKind::Agy,
                CliProviderKind::Claude,
                CliProviderKind::Agy,
            ]
        );
    }

    #[tokio::test]
    async fn auto_mode_shifts_to_agy_when_claude_quota_is_high_and_ignores_stale() {
        let dir =
            std::env::temp_dir().join(format!("career-os-quota-shift-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let status_path = dir.join("statusline.json");
        std::fs::write(
            &status_path,
            r#"{"rate_limits":{"five_hour":{"used_percentage":89.0},"seven_day":{"used_percentage":40.0}}}"#,
        )
        .unwrap();

        let runner = Arc::new(ScriptedRunner::default());
        let cfg = BridgeConfig {
            default_routing_mode: RoutingMode::Auto,
            claude_statusline_path: Some(status_path.clone()),
            statusline_max_age_secs: 900,
            claude_high_usage_threshold_pct: 85.0,
            ..BridgeConfig::default()
        };
        let router = BridgeRouter::new(cfg, runner.clone());

        router.complete(creq(AiTier::Fast, "1")).await.unwrap();
        router.complete(creq(AiTier::Balanced, "2")).await.unwrap();
        assert_eq!(
            runner.providers_called().await,
            vec![CliProviderKind::Agy, CliProviderKind::Agy]
        );

        // With statusline_max_age_secs=0 (after a tick -> stale), resume equal balancing.
        let mut stale_cfg = BridgeConfig {
            default_routing_mode: RoutingMode::Auto,
            claude_statusline_path: Some(status_path),
            statusline_max_age_secs: 0,
            claude_high_usage_threshold_pct: 85.0,
            ..BridgeConfig::default()
        };
        stale_cfg.statusline_max_age_secs = 0;
        let runner2 = Arc::new(ScriptedRunner::default());
        let router2 = BridgeRouter::new(stale_cfg, runner2.clone());
        tokio::time::sleep(Duration::from_millis(20)).await;
        router2.complete(creq(AiTier::Fast, "a")).await.unwrap();
        router2.complete(creq(AiTier::Fast, "b")).await.unwrap();
        assert_eq!(
            runner2.providers_called().await,
            vec![CliProviderKind::Claude, CliProviderKind::Agy]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn auto_mode_skips_cooldown_provider_and_fails_over() {
        let runner = Arc::new(ScriptedRunner::with(
            vec![Err(CliInvokeError::RateLimited("429".into()))],
            vec![ok("agy 1", "g1"), ok("agy 2", "g2")],
        ));
        let cfg = BridgeConfig {
            default_routing_mode: RoutingMode::Auto,
            cooldown_secs: 120,
            ..BridgeConfig::default()
        };
        let router = BridgeRouter::new(cfg, runner);

        let r1 = router.complete(creq(AiTier::Fast, "1")).await.unwrap();
        assert_eq!(r1.provider, "agy");
        assert!(r1.failover_used);

        let r2 = router.complete(creq(AiTier::Fast, "2")).await.unwrap();
        assert_eq!(r2.provider, "agy");
        assert!(!r2.failover_used);
    }

    #[cfg(unix)]
    mod spawn {
        use super::super::*;
        use crate::cli::{test_dir, write_private_file};
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            path::{Path, PathBuf},
        };

        const CONV: &str = "1d9a6a16-c517-4567-9e43-3734fac912d2";

        fn script(dir: &Path, name: &str, body: &str) -> String {
            let p = dir.join(name);
            write_private_file(&p, &format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
            p.to_string_lossy().into_owned()
        }

        fn runner(root: &Path, claude: String, agy: String) -> (SystemCliRunner, PathBuf, PathBuf) {
            let workdir = root.join("work");
            crate::cli::prepare_workdir(&workdir).unwrap();
            let brain = root.join("brain");
            fs::create_dir_all(brain.join(CONV)).unwrap();
            (
                SystemCliRunner {
                    claude_bin: claude,
                    agy_bin: agy,
                    workdir: workdir.clone(),
                    agy_brain_root: Some(brain.clone()),
                },
                workdir,
                brain,
            )
        }

        fn req(provider: CliProviderKind, secs: u64) -> InvokeRequest<'static> {
            InvokeRequest {
                provider,
                model: "m",
                system_prompt: Some("SYS-SECRET"),
                prompt: "PROMPT-SENTINEL",
                timeout: Duration::from_secs(secs),
            }
        }

        #[tokio::test]
        async fn claude_gets_prompt_on_stdin_clean_env_and_workdir() {
            let root = test_dir("spawn-claude");
            let claude = script(
                &root,
                "claude",
                r#"cat > "$PWD/stdin.txt"; env > "$PWD/env.txt"; printf '%s\n' "$@" > "$PWD/args.txt"; cp "$(eval echo \${$#})" "$PWD/sys.txt"
printf '%s' '{"type":"result","is_error":false,"result":"fake ok","usage":{"input_tokens":3,"output_tokens":4},"total_cost_usd":0.5}'"#,
            );
            let (r, wd, _) = runner(&root, claude, "agy".into());
            let out = r.invoke(req(CliProviderKind::Claude, 10)).await.unwrap();
            assert_eq!(out.content, "fake ok");
            assert_eq!(
                (out.prompt_tokens, out.completion_tokens, out.cost_usd),
                (Some(3), Some(4), Some(0.5))
            );
            assert_eq!(
                fs::read_to_string(wd.join("stdin.txt")).unwrap(),
                "PROMPT-SENTINEL"
            );
            assert_eq!(
                fs::read_to_string(wd.join("sys.txt")).unwrap(),
                "SYS-SECRET"
            );
            let args = fs::read_to_string(wd.join("args.txt")).unwrap();
            assert!(!args.contains("PROMPT-SENTINEL") && !args.contains("SYS-SECRET"));
            let env = fs::read_to_string(wd.join("env.txt")).unwrap();
            assert!(!env.contains("CARGO"), "parent env leaked: {env}");
            // System prompt temp file is removed after the run.
            assert_eq!(fs::read_dir(wd.join("tmp")).unwrap().count(), 0);
            let _ = fs::remove_dir_all(&root);
        }

        #[tokio::test]
        async fn agy_tool_step_is_killed_and_conversation_removed() {
            let root = test_dir("spawn-agy-tool");
            let agy = script(
                &root,
                "agy",
                &format!(
                    r#"cat >/dev/null
echo '{{"event":"init","conversation_id":"{CONV}","init":{{}}}}'
echo '{{"event":"step_update","step_update":{{"step_type":"tool","tool_name":"search_web","state":"ACTIVE"}}}}'
sleep 30"#
                ),
            );
            let (r, _, brain) = runner(&root, "claude".into(), agy);
            let started = Instant::now();
            let err = r.invoke(req(CliProviderKind::Agy, 60)).await.unwrap_err();
            assert!(
                matches!(err, CliInvokeError::ToolUseAttempted(ref t) if t == "search_web"),
                "{err:?}"
            );
            assert!(
                started.elapsed() < Duration::from_secs(15),
                "watchdog too slow"
            );
            assert!(!brain.join(CONV).exists());
            let _ = fs::remove_dir_all(&root);
        }

        #[tokio::test]
        async fn agy_timeout_still_cleans_up() {
            let root = test_dir("spawn-agy-timeout");
            let agy = script(
                &root,
                "agy",
                &format!(
                    r#"cat >/dev/null
echo '{{"event":"init","conversation_id":"{CONV}","init":{{}}}}'
exec sleep 30"#
                ),
            );
            let (r, _, brain) = runner(&root, "claude".into(), agy);
            let err = r.invoke(req(CliProviderKind::Agy, 1)).await.unwrap_err();
            assert!(matches!(err, CliInvokeError::TimedOut(1)), "{err:?}");
            assert!(!brain.join(CONV).exists());
            let _ = fs::remove_dir_all(&root);
        }

        #[tokio::test]
        async fn agy_success_parses_result_and_cleans_up() {
            let root = test_dir("spawn-agy-ok");
            let agy = script(
                &root,
                "agy",
                &format!(
                    r#"cat >/dev/null
echo '{{"event":"init","conversation_id":"{CONV}","init":{{}}}}'
printf '%s\n' '{{"event":"result","result":{{"conversation_id":"{CONV}","status":"SUCCESS","response":"hi\n","usage":{{"input_tokens":5,"output_tokens":2,"cache_read_tokens":1}}}}}}'"#
                ),
            );
            let (r, _, brain) = runner(&root, "claude".into(), agy);
            let out = r.invoke(req(CliProviderKind::Agy, 10)).await.unwrap();
            assert_eq!(out.content, "hi");
            assert_eq!(
                (out.prompt_tokens, out.completion_tokens, out.cost_usd),
                (Some(6), Some(2), None)
            );
            assert!(!brain.join(CONV).exists());
            let _ = fs::remove_dir_all(&root);
        }

        #[tokio::test]
        async fn missing_binary_is_unavailable() {
            let root = test_dir("spawn-missing");
            let (r, _, _) = runner(
                &root,
                root.join("nope").to_string_lossy().into_owned(),
                "agy".into(),
            );
            let err = r.invoke(req(CliProviderKind::Claude, 5)).await.unwrap_err();
            assert!(matches!(err, CliInvokeError::Unavailable(_)), "{err:?}");
            let _ = fs::remove_dir_all(&root);
        }
    }
}
