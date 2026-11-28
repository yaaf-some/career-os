# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Mac Mini Rebuild (v1)`)
**Host:** **M2 Mac mini** (arm64). Installed: `claude`, `agy`, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **`JOB-10` Verified & Archived** (`project/changes/archive/JOB-10-calm-native-ui/`): PRs `#31` (10A), `#34` (10B), and `#33` (10C) merged to `main` (`172a495`); updated `career-os-app` container deployed & verified live (Warm Paper `#F7F4EE`, `career-os-theme`, `--wp-*` CSS, all core APIs `200`).
- **Exact Next Concrete Step:** once the `JOB-10` archive PR (`docs/job-10-verify-archive`) merges, pick up the next priority: fix web demo-fallback hiding 404/5xx on settings/commute, Linear Settings display, OAuth callback UX, `needs_reply` inbox filter, Ashby public-API fallback, or `/api/jobs/{id}/tailor`.

## Active Branches / In-Flight Work

- `main` (`172a495`): `JOB-9` (auto AI routing) + `JOB-10` (Warm Paper Calm Native `@base-ui/react` + `@tanstack/react-table` v9 mobile-first PWA) shipped and live on M2.
- `docs/job-10-verify-archive`: archives `JOB-10` and refreshes `project/STATE.md` (awaiting owner merge approval).

## Container Baseline

- `app`: `node:26` alpine -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `distroless/cc-debian13:nonroot` (~51 MB); `scanner`: `node:26` alpine (~188 MB, `USER 10001:10001`). Digest-pinned, hermetic Swagger UI, `read_only`/`cap_drop: [ALL]`, GHCR `linux/arm64` only.

## Upcoming Priorities

1. Merge `JOB-10` archive PR.
2. Harden follow-ups: web demo-fallback hiding 404/5xx on settings/commute; Linear Settings display; OAuth callback raw JSON; `needs_reply` inbox filter; Ashby board without public API.
3. Implement `/api/jobs/{id}/tailor` (resume/cover-letter Google Docs grounded in `DATA_DIR` + `project_docs`).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (`agy` custom agent + deny hook + deny settings + watchdog; stdin prompts; re-run `cli_smoke -- --ignored` after CLI upgrades).
- `JOB-9` capability tiers (`fast`/`balanced`/`deep`, `>= 75.0` escalation) & `auto` equal Claude/Gemini balancing live.
- `JOB-10` Warm Paper + Terracotta mobile-first PWA (`@base-ui/react` primitives, `@tanstack/react-table` v9, 4-Part Fit Horizon, Focus Triage + Undo toast, `⌘K` Quick Capture) synced to `docs/architecture.md` & `README.md`.

## Standing Gotchas

- **Live instance:** compose project `career-os` (`docker compose -p career-os ...`); localhost calls (including `/`) need `Tailscale-User-Login`. Verify live API with `curl`.
- **Stacked PRs + squash merges:** retarget child PR base to `main` *before* merging parent with `--delete-branch` (or GitHub auto-closes child PR); never force-push or rebase pushed branches.
- SQLite migrations changing `CHECK` constraints (`evaluations`, `ai_usage_events`) require table recreation (`0006_normalize_ai_tiers.sql` pattern).
- `gh pr edit` fails (Projects classic GraphQL) -> use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Auto mode blocks `~/.claude/settings.json` and `automerge` label — ask owner.
- Dependabot: pin Docker tags numerically (`26.13 > 26.9`); Node 26 LTS; Rust `cargo` on `/opt/homebrew/opt/rustup/bin`.
- `agy -p` ignores plain stdin; `permissions.deny` skips `search_web` (PreToolUse hook blocks it).
- Zero PII/secrets in this public repo. Keep replies short (ADHD-friendly): answer/action first, clickable links.
