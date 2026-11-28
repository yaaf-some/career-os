# JOB-9 Plan — Automatic AI Capability Tiers & Equal Claude/Gemini Load Balancing

Branch per PR off `main`. Merge `origin/main` to catch up; never rebase pushed history. Pass full checks on touched crates/packages before opening PR; merge only on human approval.

## PR 9A — AI Bridge Capability Tiers & Quota-Aware Equal Balancing (`feat/job-9a-bridge-auto-balance`)

- [x] **1.1 Tier & Env Config Rename** — `crates/ai-bridge/src/{config.rs,runner.rs,lib.rs}`:
  - Replace `AiTier::{Hydrogen, Neon, Carbon}` with `AiTier::{Fast, Balanced, Deep}` plus Serde aliases (`"hydrogen"`, `"neon"`, `"carbon"`).
  - Add `claude_fast_model`, `claude_balanced_model`, `claude_deep_model`, `agy_fast_model`, `agy_balanced_model`, `agy_deep_model` in `BridgeConfig`, reading `AI_BRIDGE_*_FAST/BALANCED/DEEP_MODEL` with fallback to `AI_BRIDGE_*_HYDROGEN/NEON/CARBON_MODEL`.
  - Verify: `cargo test -p career-os-ai-bridge`
- [x] **1.2 Equal Quota-Aware Router** — `crates/ai-bridge/src/{runner.rs,lib.rs,usage.rs}`:
  - Add `RoutingMode` (`Auto | PreferClaude | PreferAgy`) on `CompleteRequest` (keeping `primary`/`allow_failover` backward compatibility).
  - Implement round-robin / least-recently-used balancing in `Auto` mode across healthy providers, cooldown/availability checks, and automatic shift away from Claude when fresh statusline 5h or 7d usage `>= 85%`.
  - Expose provider availability & balancing metrics cleanly on `GET /v1/usage`.
  - Add deterministic unit tests with `MockRunner` covering equal alternation, cooldown bypass, high-Claude-quota shift, and failover.
  - Verify: `cargo test -p career-os-ai-bridge`
- [x] **1.3 Launchd Template** — `deploy/launchd/com.career-os.ai-bridge.plist.example`:
  - Update env var keys to `AI_BRIDGE_*_FAST/BALANCED/DEEP_MODEL` while documenting backward compatibility.
  - Verify: `plutil -lint` (on macOS) and `cargo fmt --check && cargo clippy -p career-os-ai-bridge --all-targets -- -D warnings`.

## PR 9B — API Automatic Tier Assignment, Migration, Clean Settings & Web Sync (`feat/job-9b-api-auto-tiers`)

- [x] **2.1 Migration `0006` & AI Client Types** — `crates/api/migrations/0006_normalize_ai_tiers.sql`, `crates/api/src/ai/mod.rs`, `crates/api/src/openapi.rs`:
  - Normalize existing `ai_usage.tier` rows (`hydrogen -> fast`, `neon -> balanced`, `carbon -> deep`).
  - Update `AiTier` to `Fast | Balanced | Deep`, replace `AiRouting` with `{ mode: "auto" | "prefer_claude" | "prefer_agy" }` plus legacy deserialization helper.
  - Verify: `cargo test -p career-os-api ai`
- [x] **2.2 Automatic Task Routing & Escalation** — `crates/api/src/routes/ai.rs`, `crates/api/src/routes/comms.rs`, `crates/api/src/routes/settings.rs`, `crates/api/src/state.rs`:
  - Route `score_pending_batch`, project-doc digest generation, and email classification to `AiTier::Fast`.
  - Route `evaluate_job` to `AiTier::Balanced` by default and auto-escalate to `AiTier::Deep` when `job.tier1_score >= 75.0`; route draft generation to `Balanced`.
  - Validate `PUT /api/settings/ai_routing` on new `RoutingMode` schema and send `routing_mode` to `ai-bridge`.
  - Add integration tests for `>= 75.0` escalation, legacy `ai_routing` tolerance, and validation.
  - Verify: `cargo test -p career-os-api`
- [x] **2.3 Minimal Web Copy & Settings Routing Update** — `web/src/api/*`, `web/src/components/{AppShell.tsx,RoleDetailDrawer.tsx}`, `web/src/routes/{TodayView.tsx,TriageView.tsx,TrackerView.tsx,SettingsView.tsx}`, `web/src/__tests__/*`:
  - Replace `hydrogen`/`neon` UI strings and types with `Match Score` / `Deep Analysis` and `fast`/`balanced`/`deep`.
  - Simplify the Settings AI routing section to a clean `Auto | Prefer Claude | Prefer Gemini` selector plus read-only provider health/usage status (leaving full visual redesign to `JOB-10`).
  - Sync `docs/architecture.md`, `docs/glossary.md`, `README.md`.
  - Verify: `cd web && npm run typecheck && npm test && npm run build` and `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.

## Verify & Archive

- [ ] **3.1 Host Bridge Rebuild & Live M2 Check** — Rebuild `~/.local/bin/career-os-ai-bridge` (`cargo build --release -p career-os-ai-bridge`), restart `com.career-os.ai-bridge`, run `cli_smoke -- --ignored`, pull updated `career-os-app` container, verify equal Claude/Gemini routing and `>= 75` escalation live.
- [ ] **3.2 `project-verify-archive`** — Tick all ACs, archive `JOB-9-auto-ai-routing`, update `project/STATE.md`.
