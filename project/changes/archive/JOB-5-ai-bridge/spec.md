# JOB-5 — Host ai-bridge: hardened daemon, tier routing & live Usage Bar

**Status:** Verified 2026-11-27 (PRs #12, #13, #14)
**Issue:** JOB-5 (Linear, no description) · Parent JOB-1 · Branches `feat/job-5a-bridge` → `feat/job-5b-api` → `feat/job-5c-web-docs` (spec/plan ship in PR A)

## Problem / Context

The Rust `ai-bridge` crate (`crates/ai-bridge`) and the API's `HostBridgeProvider` exist, but the bridge has never been deployable or safe to run with untrusted job text, and the web UI does not match the backend:

- **Not deployable.** `deploy/launchd/com.career-os.ai-bridge.plist.example` runs `node deploy/ai-bridge/server.mjs`, which doesn't exist; it sets a dead `AI_BRIDGE_AGENT` var and its PATH misses `~/.local/bin` (where `claude`/`agy` live). No build/install step, no macOS CI.
- **Trust gap (`docs/trust.md` §19 not enforced).** Prompts containing untrusted JDs go to `claude -p` / `agy -p` with default tools enabled, as argv (visible in `ps`, size-limited), in the bridge's working directory (`runner.rs:111-114`).
- **Silent fabrication.** If `AI_BRIDGE_URL` is unset the API silently uses `MockAiProvider`, and the hourly scheduler writes mock scores into real `jobs` rows (`main.rs:44-53`, `state.rs:225-241`). URL set without token → silent 401s surfaced as 502.
- **Usage Bar is fake.** Web expects `{claude5h, claude7d, antigravity, updatedAt}` (`web/src/api/types.ts:22-39`); API returns `{bridge, db_stats_by_tier}` (`routes/ai.rs:58-62`) — live mode would crash `UsageBar.tsx:104`. Nothing produces 5h/7d percentages.
- **Tier routing settings are unwired.** Settings offer Claude/Antigravity/Codex/Gemini per tier + auto-failover, saved via a non-existent `PATCH /api/settings`; bridge routing is env-only (`AI_BRIDGE_PRIMARY`).
- **Web↔API route drift.** Web calls `POST /api/jobs/{id}/evaluate` and `/triage` (no such routes; real: `/api/ai/evaluate/{job_id}`, `/api/triage/{id}` with a different payload), silently falling back to demo data on 404.
- **Robustness.** No concurrency cap; blind failover doubles wall time past the API's fixed 120 s client timeout; all bridge errors flatten to 502; token counts always null; `json_mode`/`max_tokens`/`temperature` ignored.

## Goals

1. Bridge runs as a launchd agent on the M2 Mac mini from a `cargo install`ed binary, reachable from the app container at `host.docker.internal:8787` while bound to `127.0.0.1` (Docker Desktop / OrbStack / Kiri).
2. CLI invocations are tool-less and isolated: prompt via stdin, no built-in tools/MCP, no session persistence, empty dedicated working dir.
3. Per-tier routing (`hydrogen`, `neon`; `carbon` kept) choosing primary CLI (`claude` | `agy`) and failover on/off from Settings, honored per request.
4. Live Usage Bar backed by real data: Claude 5h/7d windows (from Claude Code statusline JSON, with staleness), Antigravity calls in last 24 h (from `ai_usage_events`) vs optional configured limit + bridge cooldown.
5. No fabricated data outside explicit demo mode: AI unconfigured ⇒ 503 + scheduler skips scoring.
6. Correct contracts and errors end to end (routes, payloads, 429/504 passthrough, token + cost recording).

## Non-Goals

- Codex / Gemini CLI providers (Settings drops them).
- `/api/jobs/{id}/tailor` backend (remains demo-only; follow-up issue).
- Removing the web client's demo fallback on 404/5xx in live mode (follow-up issue; this change removes the 404s it currently hides for evaluate/triage/settings).
- Linux/systemd bridge packaging; publishing bridge binaries as release assets.
- Persisting bridge cooldown across restarts.

## Design

### Bridge (`crates/ai-bridge`)
- **Invocation** (`runner.rs`): spawn with `current_dir` = `AI_BRIDGE_WORKDIR` (default `~/Library/Application Support/career-os-ai-bridge/work`, created 0700, empty), prompt written to **stdin**, `env_clear()` + allowlist (`PATH`, `HOME`, `USER`, `LANG`, `TMPDIR`).
  - Claude: `claude -p --model <m> --output-format json --tools "" --strict-mcp-config --no-session-persistence --system-prompt <sys>`; parse JSON result (`result`, `is_error`, `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`) — exact fields verified against the installed CLI (dev box) in task 1.2 and re-checked on the M2 in AC12.
  - Agy (verified on agy 1.5.18, task 1.2): `agy --agent career-os-bridge --input-format stream-json --output-format stream-json --sandbox --mode plan --settings <deny-json> [--model <m>] [--json-schema <s>] -p=""`. Prompt on stdin as one NDJSON line `{"event":"user","message":{"content":"<system + user prompt>"}}` (plain-text stdin is not supported: `-p` takes its value from argv). Parse the final `{"event":"result"}` line: `status`, `response`, `error`, `usage.{input_tokens,output_tokens}`, `conversation_id`; agy reports no cost (`cost_usd = null`).
  - **agy tool lockdown** (`permissions.deny` cannot block `search_web`; the hook can), four layers:
    1. Bridge writes `<workdir>/.agents/agents/career-os-bridge.md` (`mainAgent: true`, `excludeDefaultComponents: true`, `tools: []`, `inheritMcp: false`, text-only system prompt) at startup.
    2. Bridge writes `<workdir>/.agents/hooks.json`: `PreToolUse` matcher `*` ⇒ `{"decision":"deny"}` (hard-blocks every tool, incl. `search_web`).
    3. `--settings '{"permissions":{"deny":["command(*)","write_file(*)","read_file(*)","read_url(*)","execute_url(*)","mcp(*)","unsandboxed(*)"]}}'` + `--sandbox` (also stops the model rewriting layers 1–2).
    4. Stream watchdog: any `step_update` with `step_type:"tool"` ⇒ kill the child, return `ProviderError::ToolUseAttempted` (eligible for failover to claude).
  - **agy persistence**: agy always writes the conversation to `~/.gemini/antigravity-cli/brain/<conversation_id>`; the bridge deletes that directory after every run (success or failure). No agy setting exists to disable it — recorded in ADR-002.
- **Routing**: `CompleteRequest` gains `primary: Option<"claude"|"agy">` and `allow_failover: bool` (default true). Request `primary` overrides `AI_BRIDGE_PRIMARY`; cooldown reordering unchanged. Failover only on `RateLimited`, `TimedOut`, `Unavailable` (spawn/not-found), `ToolUseAttempted` (no cooldown) — not on generic non-zero exit.
- **Concurrency**: `tokio::Semaphore` (`AI_BRIDGE_MAX_CONCURRENCY`, default 2); waiting counts toward the request timeout; saturation past timeout ⇒ 503 `BRIDGE_BUSY`.
- **Errors**: codes `RATE_LIMITED`(429), `TIMED_OUT`(504), `UPSTREAM_FAILED`(502), `BRIDGE_BUSY`(503), `UNAUTHORIZED`(401), JSON body for extractor rejections (400 `BAD_REQUEST`); plus `TOOL_USE_BLOCKED`(502) and `PROVIDER_UNAVAILABLE`(503) (added in 1.4).
- **Auth**: refuse to start if `AI_BRIDGE_TOKEN` is missing, `< 32` chars, or a known placeholder (`change-me`, `changeme`, `replace-me`).
- **Usage** (`/v1/usage`): typed `claude.five_hour` / `claude.seven_day` `{used_percentage, resets_at}` parsed from statusline `rate_limits`, `statusline_updated_at` (file mtime), `stale` (> `AI_BRIDGE_STATUSLINE_MAX_AGE_SECS`, default 900); per-provider metrics + `cooldown_remaining_secs` as today. README documents a Claude Code `statusLine` command that tees its stdin JSON to `CLAUDE_STATUSLINE_PATH`.
- **Health**: `/healthz` adds `providers: {claude: bool, agy: bool}` = binary resolvable on PATH (no auth, no CLI call).

### API (`crates/api`)
- `main.rs`: provider selection → `Demo` (AI_DEMO_MODE=true ⇒ Mock), `Bridge` (URL **and** token set), else `Disabled` (new `DisabledAiProvider`: `complete` ⇒ `AppError::ServiceUnavailable("AI bridge not configured")` 503; `usage` ⇒ `configured:false`). Scheduler skips `score_pending_batch` with a warn when Disabled. URL set without token ⇒ warn + Disabled.
- `HostBridgeProvider`: per-request reqwest timeout = `timeout_secs × (allow_failover ? 2 : 1) + 15`; maps bridge 429→`AppError::RateLimited`(429), 504→`GatewayTimeout`(504), 503→503, else 502 with bridge `code` in message.
- `AiRequest` gains `primary`, `allow_failover`; filled from setting key `ai_routing` = `{"hydrogenPrimary":"claude","neonPrimary":"claude","autoFailover":true}` (defaults if absent).
- `AiResponse`/`ai_usage_events` record `prompt_tokens`, `completion_tokens`, new `cost_usd`; migration `0003_ai_bridge.sql`: `ai_usage_events.cost_usd REAL`, `evaluations.provider TEXT`.
- `GET /api/ai/usage` → camelCase `AiUsageResponse { configured, bridgeReachable, updatedAt, claude5h|null, claude7d|null, claudeStale, antigravity: {callsUsed, callsLimit|null, cooldownUntil|null, status}, dbStatsByTier }` (`callsUsed` = agy rows in last 24 h; `callsLimit` = `AI_AGY_DAILY_CALL_LIMIT` optional). OpenAPI regenerated.
- `GET/PUT /api/settings/ai_routing` validated (`claude|agy`, bool) via existing `PUT /api/settings/{key}` with a key-specific validator.

### Web (`web/src`)
- `types.ts`: `CliTierModel = 'claude' | 'agy'`; `AiUsageResponse` per API (nullable windows, `claudeStale`, `configured`).
- `UsageBar`: renders "—"/"stale"/"not configured" states; no undefined dereference.
- `client.ts`: evaluate → `POST /api/ai/evaluate/{id}` (`{tier:'neon'}`) then `GET /api/jobs/{id}`; triage → `POST /api/triage/{id}` with payload mapped to `TriageRequest`; settings tier routing → `PUT /api/settings/ai_routing`.
- `SettingsView`: options Claude Code / Antigravity only; failover toggle bound to `autoFailover`.

### Deploy / CI / Docs
- Plist runs `/Users/your-user/.local/bin/career-os-ai-bridge`; env lists every real var (placeholders only); PATH includes `/Users/your-user/.local/bin`; README: `cargo install --path crates/ai-bridge --locked --root ~/.local`, token via `openssl rand -hex 32`, `launchctl bootstrap gui/$(id -u) …` / `bootout`, statusline tee snippet, Kiri/OrbStack/Docker Desktop note.
- CI job `ai-bridge-macos` (`macos-15`, arm64) on `crates/ai-bridge/**` or `deploy/**`: `cargo build --release -p career-os-ai-bridge`, `cargo test -p career-os-ai-bridge`, `plutil -lint` the plist; added to `CI Gate`.
- Docs: `architecture.md` + `glossary.md` (Rust, not Node; glossary scanner node:26), `trust.md` (tool-less invocation, stdin, workdir, `/healthz` exempt, placeholder rejection, no mock outside demo), new `docs/adr/ADR-002-ai-bridge-cli-isolation.md`.

## Acceptance Criteria

- [x] AC1 Bridge refuses to start with missing/short/placeholder token (unit test).
- [x] AC2 Claude/agy invocations pass the prompt on stdin, never argv; argv contains the tool-less flags; cwd is the dedicated workdir; agy agent + hook files are written to the workdir; a tool `step_update` aborts the agy run; agy brain dir is removed after each run (unit tests via recording runner + one ignored-by-default real-CLI smoke test that asks agy to call `search_web` and asserts it is denied).
- [x] AC3 Request `primary` and `allow_failover=false` are honored; failover does not trigger on generic non-zero exit (unit tests).
- [x] AC4 Concurrency cap enforced; saturation returns 503 `BRIDGE_BUSY` (unit test).
- [x] AC5 `/v1/usage` returns typed 5h/7d windows + `stale` from a fixture statusline (unit test).
- [x] AC6 API with no AI config: AI routes 503, scheduler does not modify `jobs` (integration test).
- [x] AC7 Bridge 429/504 surface as API 429/504 (integration test with fake bridge).
- [x] AC8 `GET /api/ai/usage` matches web `AiUsageResponse` (shared JSON fixture tested on both sides).
- [x] AC9 Web evaluate/triage/settings hit real routes (Vitest with fetch mock asserting URL + body); UsageBar renders null/stale/unconfigured without throwing.
- [x] AC10 Token counts + cost persisted in `ai_usage_events` when the bridge returns them.
- [x] AC11 CI green incl. new `ai-bridge-macos` job and `plutil -lint`.
- [x] AC12 **On the M2 host (manual, Yaaf):** bridge runs under launchd bound to 127.0.0.1; `curl` from the app container to `host.docker.internal:8787/healthz` succeeds under the chosen runtime (Kiri/OrbStack/Docker Desktop); one neon eval completes end to end; `ps` during a run shows no prompt text; Usage Bar shows live values. *(Verified 2026-11-27 on the M2 under Docker Desktop: launchd bridge, container → `host.docker.internal:8787`, real neon evals via claude/sonnet and agy/gemini-4-neon-medium, `ps` clean, agy brain clean, usage pipeline from a real-format statusline file. Remaining one-time step for Yaaf: add the README §3 `statusLine` hook to `~/.claude/settings.json`; the agent was not permitted to edit global Claude settings. Kiri not tested.)*
- [x] AC13 Full checks pass: cargo fmt/clippy/test, web typecheck/test/build; no PII in diff.

## Docs Impact

`docs/architecture.md`, `docs/glossary.md`, `docs/trust.md`, `docs/adr/ADR-002-ai-bridge-cli-isolation.md` (new), `README.md` (bridge setup), `.env.example`, `docker-compose.yml` (empty token default), `deploy/launchd/*.plist.example`, `project/STATE.md`.

## Risks / Open Points

- Claude statusline JSON updates only while an interactive Claude Code session renders a status line; `claude -p` calls may not refresh it ⇒ shown as `stale`. Acceptable for v1; revisit if Claude CLI exposes rate-limit headers in `-p` JSON.
- agy tool lockdown relies on custom-agent + `PreToolUse` hook behaviour verified on agy 1.5.18 only; agy auto-updates, so the ignored-by-default smoke test must be re-run on the M2 (AC12) and after agy upgrades. The watchdog is the backstop; a tool could start before the kill lands (hook should deny first).
- agy conversation persistence is cleaned up by the bridge, not disabled; a crash between run and cleanup leaves one conversation on disk.
- Kiri is beta (0.2.2); host-loopback reachability is documented by Kiri but proven only by AC12.
