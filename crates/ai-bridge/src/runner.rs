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
    sync::Mutex,
};

pub use crate::cli::{looks_like_rate_limit, InvokeRequest};
use crate::{
    cli::{
        build_command_spec, parse_agy_line, parse_claude_output, remove_agy_conversation,
        write_private_file, AgyEvent, CommandSpec, ParsedOutput,
    },
    config::{BridgeConfig, CliProviderKind},
};

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
                .invoke(InvokeRequest {
                    provider,
                    model,
                    system_prompt: req.system_prompt.as_deref(),
                    prompt: &req.prompt,
                    timeout,
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
            req: InvokeRequest<'a>,
        ) -> BoxFuture<'a, Result<CliInvokeOutput, CliInvokeError>> {
            let (provider, model) = (req.provider, req.model);
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
                        prompt_tokens: None,
                        completion_tokens: None,
                        cost_usd: None,
                    })
                })
            })
        }
    }

    #[tokio::test]
    async fn failover_on_rate_limit_and_cooldown_routing() {
        let runner = Arc::new(ScriptedRunner {
            claude_results: Mutex::new(VecDeque::from([Err(CliInvokeError::RateLimited(
                "429 rate limit".to_string(),
            ))])),
            agy_results: Mutex::new(VecDeque::from([
                Ok(CliInvokeOutput {
                    content: "agy fallback ok".to_string(),
                    model: "gemini-2.5-flash-lite".to_string(),
                    latency_ms: 15,
                    prompt_tokens: None,
                    completion_tokens: None,
                    cost_usd: None,
                }),
                Ok(CliInvokeOutput {
                    content: "agy direct during cooldown".to_string(),
                    model: "gemini-2.5-pro".to_string(),
                    latency_ms: 10,
                    prompt_tokens: None,
                    completion_tokens: None,
                    cost_usd: None,
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
