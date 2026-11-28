# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Mac Mini Rebuild (v1)`)
**Host:** **M2 Mac mini** (arm64). Installed: `claude`, `agy`, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **`JOB-9` Verified & Archived** (`project/changes/archive/JOB-9-auto-ai-routing/`): PR 9A (#28) & PR 9B (#29) merged to `main` (`0fa3b52`); host `ai-bridge` rebuilt/restarted (`cli_smoke` 2/2 passed), `career-os-app` container deployed (migration `0006` live), equal `claude`/`agy` `auto` alternation + `balanced`/`deep` tier routing verified live.
- **Exact Next Concrete Step:** once the `JOB-9` archive PR (`docs/job-9-verify-archive`) is merged and `JOB-9` closed in Linear, refine `project/changes/JOB-10-calm-native-ui/{spec.md,plan.md}` from the approved Warm Paper + Terracotta mobile-first prototype and start executing `JOB-10`.

## Active Branches / In-Flight Work

- `main` (`0fa3b52`): `JOB-9` shipped (automatic `fast`/`balanced`/`deep` tiers, `>= 75` escalation, equal quota-aware `claude`/`agy` `auto` balancing, migration `0006`, unified `ai_routing`).
- `docs/job-9-verify-archive`: archives `JOB-9` and updates `project/STATE.md` (awaiting owner approval to merge).
- `JOB-10` design prototype approved ("looks good for now"): Warm Paper + Terracotta mobile-first ADHD-friendly Calm Native direction (`job10-paper-mobile-prototype.html` artifact); ready to refine spec & execute next.

## Container Baseline

- `app`: `node:26` alpine -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `distroless/cc-debian13:nonroot` (~51 MB); `scanner`: `node:26` alpine (~188 MB, `USER 10001:10001`). Digest-pinned, hermetic Swagger UI, `read_only`/`cap_drop: [ALL]`, GHCR `linux/arm64` only.

## Upcoming Priorities

1. Merge `JOB-9` archive PR and close `JOB-9` in Linear.
2. Execute **`JOB-10`** (`project/changes/JOB-10-calm-native-ui/`): Warm Paper mobile-first ADHD-friendly UI overhaul (`@base-ui/react` + `coss ui` primitives, calm motion, Focus Triage, `⌘K`).
3. Follow-ups: web demo-fallback hiding 404/5xx on settings/commute; Linear Settings display; OAuth callback raw JSON; `needs_reply` inbox filter; Ashby board with no public API.
4. Future candidate: `/api/jobs/{id}/tailor` (resume/cover-letter Docs grounded in `DATA_DIR` + `project_docs`).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (`agy` custom agent + deny hook + deny settings + watchdog; stdin prompts; re-run `cli_smoke -- --ignored` after CLI upgrades).
- `JOB-9` shipped & verified live: capability tiers (`fast`/`balanced`/`deep`, `>= 75.0` escalation, legacy `hydrogen`/`neon`/`carbon` aliases) and unified `ai_routing` (`auto|prefer_claude|prefer_agy`) synced to `docs/architecture.md` & `docs/glossary.md`.
- GCP stays in Testing mode; `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` scoped strictly to folder reads; Cloudflare untouched.

## Standing Gotchas

- **Live instance:** compose project `career-os` (`docker compose -p career-os ...`); localhost calls need `Tailscale-User-Login`. Verify live API with `curl`.
- **Stacked PRs + squash merges:** merge `origin/main` (keep branch superset on conflict); **never force-push, never rebase pushed branches, never merge without explicit owner OK.**
- SQLite migrations changing `CHECK` constraints (`evaluations`, `ai_usage_events`) require table recreation (`0006_normalize_ai_tiers.sql` pattern).
- `gh pr edit` fails (Projects classic GraphQL) -> use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Auto mode blocks `~/.claude/settings.json` and `automerge` label — ask owner.
- Dependabot: pin Docker tags numerically (`26.13 > 26.9`); Node 26 LTS; Rust `cargo` on `/opt/homebrew/opt/rustup/bin`.
- `agy -p` ignores plain stdin; `permissions.deny` skips `search_web` (PreToolUse hook blocks it).
- Zero PII/secrets in this public repo. Keep replies short (ADHD-friendly): answer/action first, clickable links.
