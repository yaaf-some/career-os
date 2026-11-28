# JOB-9 — Automatic AI Capability Tiers & Equal Claude/Gemini Load Balancing

**Status:** In Progress (PR 9A merged; PR 9B open)
**Issue:** JOB-9 (Linear) · Target Branches: `feat/job-9a-bridge-auto-balance`, `feat/job-9b-api-auto-tiers`

## Problem / Context

1. **Antigravity codenames leaked into the app:** `AiTier` (`hydrogen`, `neon`, `carbon`) in [`crates/ai-bridge/src/runner.rs`](../../../crates/ai-bridge/src/runner.rs), [`crates/api/src/ai/mod.rs`](../../../crates/api/src/ai/mod.rs), `ai_usage` SQLite rows, Settings (`AppShell.tsx`, `SettingsView.tsx`), and docs exposes Antigravity-internal model tier names inside Career OS instead of task-focused capability tiers.
2. **Manual per-tier routing in Settings:** `ai_routing` (`hydrogenPrimary`, `neonPrimary`, `autoFailover`) forces the user to manually pick a CLI per tier rather than letting the app choose the right capability tier per task and balance load across Claude and Gemini (`agy`) automatically.
3. **Under-used Gemini capacity & no score-based escalation:** `BridgeRouter::complete` sends every request to `AI_BRIDGE_PRIMARY` (Claude) unless that provider is already on cooldown, leaving Gemini (`agy`) largely idle until a 429 occurs, while deep A–G evaluation uses the mid tier regardless of whether a role is a high-conviction top match.

## Goals

1. **Task-Based Capability Tiers (`Fast | Balanced | Deep`):**
   - Replace `AiTier::{Hydrogen, Neon, Carbon}` with `AiTier::{Fast, Balanced, Deep}` across `career-os-ai-bridge` and `career-os-api`.
   - Accept legacy `"hydrogen"`, `"neon"`, `"carbon"` values via Serde deserialization aliases in `CompleteRequest` (and `AI_BRIDGE_*_HYDROGEN/NEON/CARBON_MODEL` env var fallbacks alongside `AI_BRIDGE_*_FAST/BALANCED/DEEP_MODEL` in `BridgeConfig`) so rolling restarts never break in-flight requests or existing `launchd` plists.
   - Keep `agy`'s internal upstream model names isolated strictly inside `ai-bridge` config/env defaults, never exposed as Career OS product terminology.
2. **Automatic Task-to-Tier Assignment & Auto-Escalation:**
   - Route tasks automatically in `career-os-api`:
     - **`fast`**: batch triage scoring (`score_pending_batch`), `project_docs` card digest compilation, email reply classification.
     - **`balanced`**: A–G deep job evaluation (default), interview prep briefs, Gmail follow-up draft composition.
     - **`deep`**: final CV / cover-letter tailoring, plus **automatic escalation** of A–G deep evaluation whenever a job's `tier1_score >= 75.0`.
   - Expose clear task-to-tier metadata cleanly without requiring the user to select tiers per request (`EvaluateJobRequest.tier` becomes an optional internal/admin override only).
3. **Equal, Quota-Aware Claude & Gemini (`agy`) Load Balancing:**
   - Replace `{hydrogenPrimary, neonPrimary, autoFailover}` with a unified routing preference setting `ai_routing`: `{ mode: "auto" | "prefer_claude" | "prefer_agy" }` (default `"auto"`, with legacy JSON auto-normalized on read).
   - Map `mode` in `ai-bridge` (`CompleteRequest.routing_mode` or `primary` compatibility):
     - **`auto` (default):** Consider both `claude` and `agy`. Skip any provider currently on cooldown or unavailable on `PATH`; if Claude's fresh statusline reports 5h or 7d usage `>= 85%` while `agy` is healthy, prefer `agy` automatically; otherwise alternate/round-robin equally across both healthy providers. Always keep instant failover enabled to the healthy peer on `RateLimited`, `TimedOut`, `Unavailable`, or `ToolUseAttempted`.
     - **`prefer_claude` / `prefer_agy`:** Try the preferred provider first unless on cooldown/unavailable, with automatic failover to the other.
   - Expose live provider availability, cooldowns, and routing mode in `GET /v1/usage` (`ai-bridge`) and `GET /api/ai/usage` (`career-os-api`).
4. **Database Normalization & Clean Product Copy:**
   - Add migration `crates/api/migrations/0006_normalize_ai_tiers.sql` normalizing historical `ai_usage.tier` values (`hydrogen -> fast`, `neon -> balanced`, `carbon -> deep`) while preserving `jobs.tier1_score` / `jobs.tier1_json` columns.
   - Remove `hydrogen`/`neon`/`carbon` terminology and per-tier CLI dropdowns from `web/` (replacing with `Match Score`, `Deep Analysis`, simple `Auto / Prefer Claude / Prefer Gemini` routing selector, and read-only provider health) and sync `docs/architecture.md`, `docs/glossary.md`, `README.md`, and `deploy/launchd/com.career-os.ai-bridge.plist.example`.

## Non-Goals

- Full Apple HIG / Calm Native visual redesign of the frontend (tracked in `JOB-10`).
- Adding new CLI providers beyond `claude` and `agy`.
- Weakening any ADR-002 tool-less sandbox guarantees (`--tools ""`, PreToolUse deny hook, `AGY_DENY_SETTINGS`, stream watchdog).

## Security & Trust Boundary Notes

- All subprocess isolation, env allowlisting, stdin prompt isolation, and watchdog termination rules in `crates/ai-bridge/src/cli.rs` and `runner.rs` remain unchanged.
- Any modification to `crates/ai-bridge/src/cli.rs` or `runner.rs` invocation specs requires re-verifying `cli_smoke` (`--ignored`) on the M2 host against installed `claude` and `agy` binaries.

## Acceptance Criteria

- [ ] **AC1 — Capability Tiers & Backward Aliases:** `AiTier` uses `Fast | Balanced | Deep` in both `ai-bridge` and `api`, parses legacy `"hydrogen"|"neon"|"carbon"` aliases cleanly, and reads both new (`AI_BRIDGE_*_FAST/BALANCED/DEEP_MODEL`) and legacy env vars.
- [ ] **AC2 — Automatic Task Routing & `>= 75` Escalation:** `evaluate_job` defaults to `Balanced` for roles `< 75` (or unscored) and automatically upgrades to `Deep` when `tier1_score >= 75.0`; batch triage, doc digests, and email triage use `Fast`; follow-up drafts use `Balanced`.
- [ ] **AC3 — Equal Quota-Aware Balancing in `BridgeRouter`:** Unit tests verify `mode: "auto"` balances requests across `claude` and `agy`, skips cooldown/unavailable providers, shifts load to `agy` when Claude 5h/7d usage `>= 85%`, and fails over cleanly on eligible errors.
- [ ] **AC4 — `ai_routing` Setting Migration & Validation:** `PUT /api/settings/ai_routing` validates `{ mode: "auto" | "prefer_claude" | "prefer_agy" }` and reads legacy `{ hydrogenPrimary, neonPrimary, autoFailover }` rows without 500s.
- [ ] **AC5 — Migration `0006`:** Running migrations converts `ai_usage.tier` rows (`hydrogen -> fast`, `neon -> balanced`, `carbon -> deep`) idempotently and updates `db_stats_by_tier` labels.
- [ ] **AC6 — Clean App Terminology & Docs:** App UI, OpenAPI schema, and docs contain zero `hydrogen`/`neon`/`carbon` capability-tier labels; full checks pass (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `web` `npm run typecheck && npm test && npm run build`).
- [ ] **AC7 — Live M2 Verification:** Rebuild host `~/.local/bin/career-os-ai-bridge` + restart launchd service, deploy updated `career-os-app` container, verify both `claude` and `agy` handle requests under `auto` mode, and confirm `>= 75` deep-eval escalation live.

## Docs Impact

- `docs/architecture.md` — Document automatic `fast`/`balanced`/`deep` task routing and `auto` equal balancing.
- `docs/glossary.md` — Replace `hydrogen / neon / carbon` with `fast / balanced / deep` and update `ai_routing`.
- `README.md` & `deploy/launchd/com.career-os.ai-bridge.plist.example` — Update model env var names and defaults.
