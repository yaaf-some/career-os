# ADR-002: Tool-less, Isolated CLI Invocation in the Host ai-bridge

- **Status:** Accepted
- **Date:** 2026-11-27
- **Change:** JOB-5 (`project/changes/JOB-5-ai-bridge/`)

## Context

AI scoring and evaluation run on the user's existing Claude Code (`claude`) and Antigravity (`agy`) subscriptions, through a host daemon (ADR-001). Prompts contain untrusted job postings, and both CLIs are agents: by default they can run shell commands, read and write files, call MCP servers and search the web. A prompt injection in a job description could otherwise turn a scoring call into actions on the host.

Other constraints:

- `claude --bare` would drop most defaults, but it skips the keychain read, which breaks subscription auth. Not usable.
- agy (1.5.18) has no flag that turns tools off, takes `-p` input oddly (the next flag becomes the prompt), and always saves conversations to `~/.gemini/antigravity-cli/brain/<uuid>`. Its `search_web` tool is server-side Google grounding, so `permissions.deny` can't block it.
- Both CLIs auto-update.

## Decision

The bridge (`crates/ai-bridge`, Rust) treats both CLIs as text-only completion engines.

**Both CLIs**
- The prompt goes in on **stdin**, never argv, so `ps` shows no prompt text and argv size limits don't apply.
- Each run uses a private **0700 workdir** (`AI_BRIDGE_WORKDIR`), an **env allowlist** (`PATH HOME USER LANG TMPDIR`), `kill_on_drop`, and capped stdout and stderr.
- Per-request timeout; a concurrency cap (`AI_BRIDGE_MAX_CONCURRENCY`) where time spent waiting for a slot counts against the timeout.

**claude**

```
claude -p --model <m> --output-format json --tools "" --strict-mcp-config \
  --no-session-persistence --setting-sources "" --disable-slash-commands \
  --system-prompt-file <0600 temp file, deleted after the run>
```

The JSON result (`result`, `is_error`, `usage`, `total_cost_usd`, `api_error_status`) is authoritative. A rate limit is detected only from `api_error_status` or the error text.

**agy**: four independent layers, because none of them is sufficient alone.

```
agy --agent career-os-bridge --model <m> --input-format stream-json \
  --output-format stream-json --sandbox --mode plan --settings <deny JSON> -p=
```

1. **Custom agent** written into the workdir at startup (`.agents/agents/career-os-bridge.md`). Its frontmatter sets `mainAgent: true`, `excludeDefaultComponents: true`, `tools: []` and `inheritMcp: false`. agy resolves `--agent` by the frontmatter name, not the file name.
2. **`PreToolUse` hook** (`.agents/hooks.json`, matcher `*`) that answers `deny` for every tool, using absolute `/bin/cat` and `/bin/echo` so launchd's PATH can't make it fail open. This is the only layer that blocks `search_web`, and it was verified alone, without `--agent`.
3. **`permissions.deny`** for `command`, `read_file`, `write_file`, `read_url`, `execute_url`, `mcp` and `unsandboxed`, plus `--sandbox --mode plan`.
4. **Stream watchdog.** Any `step_update` with `step_type: "tool"` kills the child. The run returns `ToolUseAttempted` (HTTP 502 `TOOL_USE_BLOCKED`) and fails over to claude without putting agy on cooldown.

After every run (success, error, tool kill, timeout), the bridge deletes agy's conversation directory, after checking the id looks like a UUID.

**Routing and errors**
- Each request sets `primary` (claude or agy) and `allow_failover`.
- Failover happens only on a rate limit, a timeout, a CLI that won't start, or a tool attempt. A generic non-zero exit doesn't fail over, because a retry on the other CLI would double wall time for what is usually a prompt problem.
- Errors carry stable codes: `RATE_LIMITED` 429, `TIMED_OUT` 504, `UPSTREAM_FAILED` 502, `TOOL_USE_BLOCKED` 502, `BRIDGE_BUSY` 503, `PROVIDER_UNAVAILABLE` 503, `UNAUTHORIZED` 401, `BAD_REQUEST` 400.

**Startup and lifecycle**
- The bridge refuses to start with a missing, short (< 32 chars) or placeholder token.
- `/healthz` is unauthenticated and returns booleans only.
- On SIGTERM it drains for 20 s, then drops in-flight runs so `kill_on_drop` reaps the CLIs. The plist sets `ExitTimeOut` to 30.

**Verification**
- Unit tests spawn fake CLI scripts to check stdin, argv, env, cwd, temp-file removal, the watchdog kill and brain cleanup.
- An ignored-by-default smoke test sends an injection prompt to the real CLIs: `cargo test -p career-os-ai-bridge --test cli_smoke -- --ignored --nocapture`. It must be re-run after every claude or agy upgrade.

## Consequences

**Positive**
- Untrusted job text can't make either CLI touch the host, the network or MCP.
- Prompts don't leak via `ps`.
- No agy conversation history accumulates.
- The API gets typed errors, tokens and cost.

**Trade-offs and residual risks**
- The agy lockdown depends on behavior verified on agy 1.5.18 only. agy auto-updates, so the smoke test is the guard.
- A server-side `search_web` could start before the watchdog's kill lands. The hook should deny it first.
- If a request future is dropped (client disconnect, or the shutdown drain timing out), agy cleanup is skipped and one conversation can stay on disk. Leftover claude system-prompt files are cleared at the next startup.
- Killing agy kills only the agy process, not its process group, so anything it started could outlive it.
- agy probably still keeps a row in its own `conversation_summaries.db`.
- Claude 5 h / 7 d usage comes from Claude Code's statusline file. It only refreshes during interactive use, so the Usage Bar marks it stale.
- `json_mode` is a system-prompt instruction, not a schema flag, so the API still parses defensively (strips code fences).
