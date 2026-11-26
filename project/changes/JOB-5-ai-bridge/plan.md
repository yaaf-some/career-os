# JOB-5 Plan — Host ai-bridge

Branch per PR off `main` (merge `origin/main` to catch up; never rebase pushed history). Three PRs, each green on `CI Gate` before the next.
**Delegation:** `[haiku]` = one Haiku subagent gets only this task, `spec.md`, and the listed files (Goldfish); it never commits/pushes. `[lead]` = orchestrator does it (cross-cutting, judgment, or host-only). The lead reviews every diff and runs the Verify line before checking the box.
Rust verify: `export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH` (Homebrew rustup on the M2).

## PR A — Bridge + deploy + macOS CI (`feat/job-5a-bridge`)

- [ ] **1.1 [haiku] Config hardening** — `crates/ai-bridge/src/config.rs`, `src/main.rs`: token validation (missing / <32 chars / placeholders ⇒ startup error), new vars `AI_BRIDGE_WORKDIR`, `AI_BRIDGE_MAX_CONCURRENCY`(2), `AI_BRIDGE_STATUSLINE_MAX_AGE_SECS`(900); `#[cfg(test)]` tests for defaults + rejection (inject env via a map, not global env).
  Verify: `cargo test -p career-os-ai-bridge config`
- [x] **1.2 [lead] Pin CLI contracts** — run `claude -p --output-format json --tools "" …` and `agy -p --output-format json --sandbox --mode plan …` with stdin on the dev box; save sanitized sample outputs as `crates/ai-bridge/tests/fixtures/{claude_print.json,agy_stream_ok.jsonl,agy_stream_tool_denied.jsonl}`; record exact flags in `Execution Notes`.
  Verify: fixtures committed, flags noted.
- [ ] **1.3 [haiku] Isolated invocation** — `src/runner.rs` `SystemCliRunner`: stdin prompt, flags from 1.2, `--system-prompt` for claude, `env_clear` + allowlist, `current_dir(workdir)` (create 0700), agy per spec (stream-json stdin line, `--agent career-os-bridge`, deny `--settings`; write agent + `hooks.json` into workdir at startup; watchdog kills on a tool `step_update` ⇒ `ProviderError::ToolUseAttempted`; delete `~/.gemini/antigravity-cli/brain/<conversation_id>` after each run); parse JSON outputs (content, tokens, cost) using fixtures; `CliOutput` gains `prompt_tokens`, `completion_tokens`, `cost_usd`. Add `ProviderError::Unavailable` for spawn/not-found. Tests: argv/stdin/env/cwd via a `CommandSpec` builder unit-tested without spawning; fixture parsing.
  Verify: `cargo test -p career-os-ai-bridge runner`
- [ ] **1.4 [haiku] Routing, failover policy, concurrency, errors** — `src/runner.rs`, `src/lib.rs`: request `primary` + `allow_failover`; failover only on RateLimited/TimedOut/Unavailable; `Semaphore` with wait counted in timeout ⇒ `Busy`; error codes/status per spec; JSON 400 for bad bodies. Tests for each (extend `ScriptedRunner`).
  Verify: `cargo test -p career-os-ai-bridge`
- [ ] **1.5 [haiku] Usage + health** — `src/usage.rs`, `src/lib.rs`: typed `five_hour`/`seven_day` from statusline `rate_limits`, mtime ⇒ `statusline_updated_at`, `stale`; `/healthz` `providers` PATH check. Fixture-based tests incl. missing/malformed file.
  Verify: `cargo test -p career-os-ai-bridge usage`
- [ ] **1.6 [haiku] launchd plist + README bridge section** — `deploy/launchd/com.career-os.ai-bridge.plist.example`, `README.md` §3, `.env.example`, `docker-compose.yml` (token default empty). Placeholders only (`your-user`, `<generate: openssl rand -hex 32>`).
  Verify: `plutil -lint` in CI (1.7); `grep -rn "change-me" deploy README.md .env.example docker-compose.yml` empty.
- [ ] **1.7 [haiku] macOS CI job** — `.github/workflows/ci.yml`: `ai-bridge` path filter, job `ai-bridge-macos` on `macos-15` (pinned actions as in file), build/test/`plutil -lint`, add to `ci-gate` needs/env/loop.
  Verify: actionlint passes in CI; job green on PR.
- [ ] **1.8 [lead] Full checks + PR A** — fmt/clippy/test; PII grep; open PR, CI green, ask Yaaf to merge.

## PR B — API contract (`feat/job-5b-api`)

- [ ] **2.1 [haiku] Migration 0003** — `crates/api/migrations/0003_ai_bridge.sql`: `ai_usage_events.cost_usd REAL`, `evaluations.provider TEXT`.
  Verify: `cargo test -p career-os-api` (migrations run in tests).
- [ ] **2.2 [haiku] Provider selection, no silent mock** — `src/main.rs`, `src/ai/mod.rs` (`DisabledAiProvider`), `src/error.rs` (`ServiceUnavailable`, `RateLimited`, `GatewayTimeout`), `src/scheduler.rs` skip when disabled. Tests: disabled ⇒ 503 on AI routes, scheduler leaves `jobs` untouched.
  Verify: `cargo test -p career-os-api`
- [ ] **2.3 [haiku] HostBridgeProvider** — `src/ai/mod.rs`: `primary`/`allow_failover` fields, per-request timeout formula, status mapping, tokens/cost in `AiResponse`; integration test with an in-process fake bridge (axum on 127.0.0.1:0) for 200/429/504/401.
  Verify: `cargo test -p career-os-api ai::`
- [ ] **2.4 [haiku] ai_routing setting + call sites** — `src/routes/settings.rs` (validator for key `ai_routing`), `src/state.rs` + `src/routes/ai.rs` read it into `AiRequest`; persist tokens/cost/provider. Tests for validation + passthrough.
  Verify: `cargo test -p career-os-api`
- [ ] **2.5 [haiku] Usage endpoint** — `src/routes/ai.rs`: camelCase `AiUsageResponse` per spec from bridge `/v1/usage` + DB (agy 24 h count, `AI_AGY_DAILY_CALL_LIMIT`); shared fixture `web/src/__tests__/fixtures/ai-usage.json` produced by a Rust test (snapshot) — lead creates fixture path first.
  Verify: `cargo test -p career-os-api usage`; OpenAPI export step in CI.
- [ ] **2.6 [lead] Full checks + PR B.**

## PR C — Web + docs (`feat/job-5c-web-docs`)

- [ ] **3.1 [haiku] Types + client routes** — `web/src/api/types.ts`, `client.ts`, `queries.ts`, `demoData.ts` (demo shape updated): evaluate/triage/settings per spec. Vitest asserting URL/method/body with mocked fetch.
  Verify: `cd web && npm run typecheck && npm test`
- [ ] **3.2 [haiku] UsageBar + Settings UI** — `web/src/components/UsageBar.tsx`, `web/src/lib/usage.ts`, `web/src/routes/SettingsView.tsx`: null/stale/unconfigured states; claude/agy only; failover toggle. Tests use the shared API fixture from 2.5.
  Verify: `cd web && npm test && npm run build`
- [ ] **3.3 [haiku] Docs sync** — `docs/architecture.md`, `docs/glossary.md`, `docs/trust.md`, new `docs/adr/ADR-002-ai-bridge-cli-isolation.md` (content from spec Design + 1.2 notes).
  Verify: lead review; no "Node" for ai-bridge (`grep -n "ai-bridge" docs/*.md`).
- [ ] **3.4 [lead] Full checks + PR C**, then `project-verify-archive` (AC1–AC11).
- [ ] **3.5 [Yaaf on M2] Host acceptance (AC12)** — install, bootstrap, container→bridge curl under Kiri, one neon eval, `ps` check, Usage Bar live.

## Execution Notes / Deviations

- **2026-11-26 · 1.2 (M2, claude 2.1.332, agy 1.5.18):**
  - claude: `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence --system-prompt <sys>` with stdin prompt works; 0 tools. Fields: `result`, `is_error`, `subtype`, `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`, `api_error_status`.
  - agy: `-p` always takes its value from argv (`-p=-` is a literal prompt), so plain-text stdin is impossible; use `--input-format stream-json --output-format stream-json -p=""` with stdin `{"event":"user","message":{"content":...}}`. Result line `{"event":"result","result":{status,response,error,usage,conversation_id}}`; no cost.
  - agy `--mode plan` alone still runs tools (writes `implementation_plan.md` into its brain dir). `permissions.deny` (schema: `command|read_file|write_file|read_url|execute_url|mcp|unsandboxed`) blocks those but NOT `search_web` (server-side Google grounding), even with `"*"`.
  - Lockdown that works: custom agent (`tools: []`, `excludeDefaultComponents: true`, `inheritMcp: false`) ⇒ model reports no search tool; `.agents/hooks.json` `PreToolUse` `*` ⇒ deny hard-blocks `search_web` ("tool call denied by pre-tool hook"). Both loaded from the cwd's `.agents/` without workspace trust. `init.tools` still lists the full pool, so don't use it as proof.
  - agy always persists conversations to `~/.gemini/antigravity-cli/brain/<id>`; no flag/setting (agy docs: cli/headless.md, settings schema) — bridge deletes after run.
  - Spec approved with this agy design (agy may be a tier primary; claude stays default).
