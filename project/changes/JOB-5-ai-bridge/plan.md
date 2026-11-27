# JOB-5 Plan — Host ai-bridge

Branch per PR off `main` (merge `origin/main` to catch up; never rebase pushed history). Three PRs, each green on `CI Gate` before the next.
**Execution:** the lead session implements every task directly (no subagent delegation, per Yaaf 2026-11-27). Run each task's Verify line before checking the box.
Rust verify: `export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH` (Homebrew rustup on the M2).

## PR A — Bridge + deploy + macOS CI (`feat/job-5a-bridge`)

- [x] **1.1 Config hardening** — `crates/ai-bridge/src/config.rs`, `src/main.rs`: token validation (missing / <32 chars / placeholders ⇒ startup error), new vars `AI_BRIDGE_WORKDIR`, `AI_BRIDGE_MAX_CONCURRENCY`(2), `AI_BRIDGE_STATUSLINE_MAX_AGE_SECS`(900); `#[cfg(test)]` tests for defaults + rejection (inject env via a map, not global env).
  Verify: `cargo test -p career-os-ai-bridge config`
- [x] **1.2 Pin CLI contracts** — run `claude -p --output-format json --tools "" …` and `agy -p --output-format json --sandbox --mode plan …` with stdin on the dev box; save sanitized sample outputs as `crates/ai-bridge/tests/fixtures/{claude_print.json,agy_stream_ok.jsonl,agy_stream_tool_denied.jsonl}`; record exact flags in `Execution Notes`.
  Verify: fixtures committed, flags noted.
- [x] **1.3 Isolated invocation** — `src/runner.rs` `SystemCliRunner`: stdin prompt, flags from 1.2, `--system-prompt` for claude, `env_clear` + allowlist, `current_dir(workdir)` (create 0700), agy per spec (stream-json stdin line, `--agent career-os-bridge`, deny `--settings`; write agent + `hooks.json` into workdir at startup; watchdog kills on a tool `step_update` ⇒ `ProviderError::ToolUseAttempted`; delete `~/.gemini/antigravity-cli/brain/<conversation_id>` after each run); parse JSON outputs (content, tokens, cost) using fixtures; `CliOutput` gains `prompt_tokens`, `completion_tokens`, `cost_usd`. Add `ProviderError::Unavailable` for spawn/not-found. Tests: argv/stdin/env/cwd via a `CommandSpec` builder unit-tested without spawning; fixture parsing.
  Verify: `cargo test -p career-os-ai-bridge runner`
- [x] **1.4 Routing, failover policy, concurrency, errors** — `src/runner.rs`, `src/lib.rs`: request `primary` + `allow_failover`; failover only on RateLimited/TimedOut/Unavailable; `Semaphore` with wait counted in timeout ⇒ `Busy`; error codes/status per spec; JSON 400 for bad bodies. Tests for each (extend `ScriptedRunner`).
  Verify: `cargo test -p career-os-ai-bridge`
- [x] **1.5 Usage + health** — `src/usage.rs`, `src/lib.rs`: typed `five_hour`/`seven_day` from statusline `rate_limits`, mtime ⇒ `statusline_updated_at`, `stale`; `/healthz` `providers` PATH check. Fixture-based tests incl. missing/malformed file.
  Verify: `cargo test -p career-os-ai-bridge usage`
- [x] **1.6 launchd plist + README bridge section** — `deploy/launchd/com.career-os.ai-bridge.plist.example`, `README.md` §3, `.env.example`, `docker-compose.yml` (token default empty). Placeholders only (`your-user`, `<generate: openssl rand -hex 32>`).
  Verify: `plutil -lint` in CI (1.7); `grep -rn "change-me" deploy README.md .env.example docker-compose.yml` empty.
- [x] **1.7 macOS CI job** — `.github/workflows/ci.yml`: `ai-bridge` path filter, job `ai-bridge-macos` on `macos-15` (pinned actions as in file), build/test/`plutil -lint`, add to `ci-gate` needs/env/loop.
  Verify: actionlint passes in CI; job green on PR.
- [x] **1.8 Full checks + PR A** ([#12](https://github.com/yaaf-some/career-os/pull/12)) — fmt/clippy/test; PII grep; open PR, CI green, ask Yaaf to merge.

## PR B — API contract (`feat/job-5b-api`)

- [x] **2.1 Migration 0003** — `crates/api/migrations/0003_ai_bridge.sql`: `ai_usage_events.cost_usd REAL`, `evaluations.provider TEXT`.
  Verify: `cargo test -p career-os-api` (migrations run in tests).
- [x] **2.2 Provider selection, no silent mock** — `src/main.rs`, `src/ai/mod.rs` (`DisabledAiProvider`), `src/error.rs` (`ServiceUnavailable`, `RateLimited`, `GatewayTimeout`), `src/scheduler.rs` skip when disabled. Tests: disabled ⇒ 503 on AI routes, scheduler leaves `jobs` untouched.
  Verify: `cargo test -p career-os-api`
- [x] **2.3 HostBridgeProvider** — `src/ai/mod.rs`: `primary`/`allow_failover` fields, per-request timeout formula, status mapping, tokens/cost in `AiResponse`; integration test with an in-process fake bridge (axum on 127.0.0.1:0) for 200/429/504/401.
  Verify: `cargo test -p career-os-api ai::`
- [x] **2.4 ai_routing setting + call sites** — `src/routes/settings.rs` (validator for key `ai_routing`), `src/state.rs` + `src/routes/ai.rs` read it into `AiRequest`; persist tokens/cost/provider. Tests for validation + passthrough.
  Verify: `cargo test -p career-os-api`
- [x] **2.5 Usage endpoint** — `src/routes/ai.rs`: camelCase `AiUsageResponse` per spec from bridge `/v1/usage` + DB (agy 24 h count, `AI_AGY_DAILY_CALL_LIMIT`); shared fixture `web/src/__tests__/fixtures/ai-usage.json` produced by a Rust test (snapshot) — lead creates fixture path first.
  Verify: `cargo test -p career-os-api usage`; OpenAPI export step in CI.
- [ ] **2.6 Full checks + PR B.**

## PR C — Web + docs (`feat/job-5c-web-docs`)

- [x] **3.1 Types + client routes** — `web/src/api/types.ts`, `client.ts`, `queries.ts`, `demoData.ts` (demo shape updated): evaluate/triage/settings per spec. Vitest asserting URL/method/body with mocked fetch.
  Verify: `cd web && npm run typecheck && npm test`
- [x] **3.2 UsageBar + Settings UI** — `web/src/components/UsageBar.tsx`, `web/src/lib/usage.ts`, `web/src/routes/SettingsView.tsx`: null/stale/unconfigured states; claude/agy only; failover toggle. Tests use the shared API fixture from 2.5.
  Verify: `cd web && npm test && npm run build`
- [x] **3.3 Docs sync** — `docs/architecture.md`, `docs/glossary.md`, `docs/trust.md`, new `docs/adr/ADR-002-ai-bridge-cli-isolation.md` (content from spec Design + 1.2 notes).
  Verify: lead review; no "Node" for ai-bridge (`grep -n "ai-bridge" docs/*.md`).
- [ ] **3.4 Full checks + PR C**, then `project-verify-archive` (AC1–AC11).
- [ ] **3.5 [Yaaf on M2] Host acceptance (AC12)** — install, bootstrap, container→bridge curl under Kiri, one neon eval, `ps` check, Usage Bar live.

## Execution Notes / Deviations

- **2026-11-26 · 1.2 (M2, claude 2.1.332, agy 1.5.18):**
  - claude: `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence --system-prompt <sys>` with stdin prompt works; 0 tools. Fields: `result`, `is_error`, `subtype`, `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`, `api_error_status`.
  - agy: `-p` always takes its value from argv (`-p=-` is a literal prompt), so plain-text stdin is impossible; use `--input-format stream-json --output-format stream-json -p=""` with stdin `{"event":"user","message":{"content":...}}`. Result line `{"event":"result","result":{status,response,error,usage,conversation_id}}`; no cost.
  - agy `--mode plan` alone still runs tools (writes `implementation_plan.md` into its brain dir). `permissions.deny` (schema: `command|read_file|write_file|read_url|execute_url|mcp|unsandboxed`) blocks those but NOT `search_web` (server-side Google grounding), even with `"*"`.
  - Lockdown that works: custom agent (`tools: []`, `excludeDefaultComponents: true`, `inheritMcp: false`) ⇒ model reports no search tool; `.agents/hooks.json` `PreToolUse` `*` ⇒ deny hard-blocks `search_web` ("tool call denied by pre-tool hook"). Both loaded from the cwd's `.agents/` without workspace trust. `init.tools` still lists the full pool, so don't use it as proof.
  - agy always persists conversations to `~/.gemini/antigravity-cli/brain/<id>`; no flag/setting (agy docs: cli/headless.md, settings schema) — bridge deletes after run.
  - Spec approved with this agy design (agy may be a tier primary; claude stays default).
- **1.6 reminder:** 1.1 makes the bridge exit non-zero on a bad/placeholder token; the plist uses `KeepAlive` true, so 1.6 must add `ThrottleInterval` (e.g. 30) or `KeepAlive`→`{SuccessfulExit: false}` + throttle to avoid a tight respawn loop.
- **2026-11-27 · 1.3 (minor deviations, no re-approval):**
  - claude also gets `--setting-sources ""` (no user hooks/settings) and `--disable-slash-commands`; system prompt goes via `--system-prompt-file` (0600 temp file in `<workdir>/tmp`, deleted after the run) so neither prompt is in `ps`. `--bare` rejected: it skips keychain reads (breaks subscription auth).
  - Default system prompt (text-only, untrusted-data notice) is always sent when the caller omits one, so no CLI loads its tool-describing default.
  - Both CLIs verified working under `env -i` with only `PATH HOME USER LANG TMPDIR`.
  - agy `--agent` resolves by frontmatter `name:`, not filename. agy init event carries `conversation_id` at top level.
  - agy model defaults → `gemini-4-{hydrogen,neon,carbon}-medium` (`gemini-2.5-*` no longer listed by `agy models`).
  - New code lives in `src/cli.rs` (pure spec/parse/workdir) + `SystemCliRunner` in `runner.rs`. Error enum kept as `CliInvokeError` (+ `Unavailable`, `ToolUseAttempted`); provisional HTTP 503/502 until 1.4.
  - `prompt_tokens` = input + cache-creation + cache-read tokens (claude) / input + cache_read (agy).
  - `json_mode` → agy `--json-schema` deferred to 1.4 (needs a schema per call site).
  - Residual (for ADR-002): killing agy doesn't kill its process group; a client disconnect drops the future before brain cleanup; agy likely keeps a row in `conversation_summaries.db`.
  - Real-CLI smoke test `tests/cli_smoke.rs` (ignored) passed on the M2: both CLIs refused an injection prompt with zero tool steps; brain dir count unchanged.
  - Generated `hooks.json` (absolute `/bin/cat` + `/bin/echo`, so it can't fail open under launchd PATH) verified against real agy **without** `--agent` under `env -i`: `search_web` ⇒ "denied by pre-tool hook". So the hook alone holds if a future agy ignores `tools: []`.
- **1.4 note:** spec Routing bullet omits `ToolUseAttempted` from failover triggers but the agy lockdown section requires it ⇒ in 1.4 include it in the failover set, give it its own code, add a test, and don't put agy on cooldown for it. API has no `deny_unknown_fields`, so PR A's added `cost_usd` is safe before PR B.
- **2026-11-27 · 1.4 done:** `BridgeError { Upstream(CliInvokeError), Busy }` with `status_and_code()`. Failover set = RateLimited/TimedOut/Unavailable/ToolUseAttempted (`is_failover_eligible`); only RateLimited sets cooldown. Extra codes beyond spec: `TOOL_USE_BLOCKED` (502), `PROVIDER_UNAVAILABLE` (503, CLI missing/unspawnable). Semaphore permit held across both attempts; slot wait is deducted from the first attempt's timeout, failover attempt gets the full timeout (API budget 2x+15). Busy if <1 s left after the wait. `json_mode` = system-prompt instruction for both CLIs (no schema flags; revisit if JSON parse failures show up). New metric `busy_rejections`.
- **2026-11-27 · 1.5 done:** statusline `rate_limits.{five_hour,seven_day}.{used_percentage (0–100), resets_at (unix s)}` confirmed from the claude 2.1.332 binary. `/v1/usage` now returns `claude: {five_hour, seven_day, statusline_updated_at (unix s), stale} | null` (null = `CLAUDE_STATUSLINE_PATH` unset) + `metrics`; the raw `statusline` field is dropped (it carries cwd/workspace paths). API currently reads `statusline` as optional ⇒ becomes null until 2.5 switches to `claude`. `/healthz` adds `providers.{claude,agy}.available` (booleans only) and `status: degraded` when the primary CLI isn't found.
- **2026-11-27 · 1.6 done:** plist runs `~/.local/bin/career-os-ai-bridge` (`cargo install --path crates/ai-bridge --locked --root ~/.local`, per spec), PATH includes `~/.local/bin` (where claude + agy install), `KeepAlive {SuccessfulExit:false}` + `ThrottleInterval 30` + `ExitTimeOut 30`. Bridge now handles SIGTERM (launchd's stop signal; before only Ctrl-C): 20 s drain, then returns so `kill_on_drop` reaps in-flight CLIs. Logs drop ANSI colors when not on a TTY. `.env.example`/compose token default empty. README §3 rewritten (install, bootstrap, healthz, env table, statusLine tee). Live check: binary serves `/healthz` with both CLIs found, exits 0 on SIGTERM, exits 1 on placeholder token.
- **2026-11-27 · PR B (2.1–2.5) done**, stacked on PR A (spec/plan live only on A's branch; B opened as draft against `main`, merge `origin/main` into B after #12 lands, no rebase).
  - Provider selection: `AI_DEMO_MODE` ⇒ Mock; URL + token ⇒ bridge; otherwise `DisabledAiProvider` (`is_enabled() == false`). Disabled: `score-pending`/`evaluate` 503 `SERVICE_UNAVAILABLE` before any write; scheduler skips scoring before inserting its `sync_runs` row; `/api/ai/usage` 200 `configured:false`.
  - Error mapping deviations (agreed with advisor): bridge 401/400 ⇒ API 502 (a 401 would look like the user's Tailscale auth failing); connect failure ⇒ 503 "bridge unreachable"; reqwest timeout ⇒ 504. Bridge `code` stays in the message so 503 `BRIDGE_BUSY` vs `PROVIDER_UNAVAILABLE` remain distinguishable.
  - `timeout_secs` always sent, clamped 5–300; per-request client timeout = t × (failover ? 2 : 1) + 15; no global client timeout (5 s connect timeout).
  - `ai_routing` PUT validated (camelCase, all 3 fields, `deny_unknown_fields`) ⇒ 400; reader falls back to defaults with a warning. Carbon follows `neonPrimary`.
  - `GET /api/ai/usage` field names follow the existing web types (`claude5h.{percentUsed,resetAt}`, `antigravity.status: ready|cooldown|exhausted`) plus spec additions (`configured`, `bridgeReachable`, `claudeStale`, `dbStatsByTier`, nullable windows); timestamps RFC 3339. Shared fixture `web/src/__tests__/fixtures/ai-usage.json` is checked by `routes::ai::tests::ai_usage_fixture_matches_web` (regenerate with `UPDATE_FIXTURES=1`). Web consumes it in 3.1/3.2, so **C must follow B** (web types still non-nullable until then; the client already falls back to demo data on 5xx).
  - Known gap: failed calls are recorded under provider `host-bridge` (the bridge doesn't say which CLI failed), so an agy failure with failover off doesn't count toward `callsUsed`.
  - New optional env `AI_AGY_DAILY_CALL_LIMIT`.
- **2026-11-27 · 3.1–3.2 done** (stacked on B). `requestWithFallback` gains `fallbackOnServerError` (default true); evaluate turns it off so a 503 (AI disabled) or other bridge error surfaces as `ApiError {status, code}` instead of a fake demo eval. Network errors still fall back to demo (no-backend dev mode). Triage maps web actions → API (`approve`/`shortlist`→`shortlist`, `skip`→`skip`, `reject`→`blacklist`). `getSettings` maps `GET /api/settings` (only `ai_routing` is server-side; other fields neutral, not demo data); routing saves `PUT /api/settings/ai_routing` with the full object; commute prefs stay demo-store only (no API). Evaluate/triage re-read the job via the existing `getJob` — **follow-up:** API `JobDetailResponse` (snake_case) is still cast to web `JobDetail` without mapping (pre-existing). UsageBar: unconfigured / bridge offline / stale / null windows; agy without limit shows "N calls today".
- **2026-11-27 · 3.3 done:** architecture (Rust bridge row + diagram), glossary (agy, ai_routing, failover, disabled mode, tiers, statusline; scanner node:26; sorted), trust §4 Host AI CLI Isolation, ADR-002 (decision, four agy layers, residual risks). README links ADR-002.
- **AC status before verify-archive:** AC1–AC10 + AC13 covered by tests/checks across PRs A–C; AC11 = CI on #12/#13/C; AC12 = Yaaf on the M2 (task 3.5).
- **2026-11-27 · C follow-up:** evaluate errors now render in the role drawer (`describeAiError`; disabled bridge ⇒ "AI is not configured…"); `getAiUsage` no longer falls back to demo numbers on a live API 5xx (bar renders nothing).

