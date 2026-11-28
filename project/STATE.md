# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Mac Mini Rebuild (v1)`)
**Host:** **M2 Mac mini** (arm64). Installed: `claude`, `agy`, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **`JOB-9` & `JOB-10` Shipped, Verified & Archived:** `JOB-9` (`#28`–`#30`) and `JOB-10` (`#31`, `#34`, `#33`, `#35`) are both merged to `main` (`a469075`), deployed live on M2 (`ai-bridge` + `career-os-app`), verified, and archived under `project/changes/archive/`. No active changes in `project/changes/`.
- **Exact Next Concrete Step:** propose the next change (`project-propose`) — either **hardening follow-ups** (web demo-fallback hiding 404/5xx on settings/commute, Linear Settings display, OAuth callback UX, `needs_reply` inbox filter, Ashby non-API fallback) or **`/api/jobs/{id}/tailor`** (resume/cover-letter Google Docs grounded in `DATA_DIR` + `project_docs`).

## Active Branches / In-Flight Work

- `main` (`a469075`): clean, zero open PRs; host `ai-bridge` (`launchd`) and `career-os-app` container running latest `main` (`JOB-9` auto AI routing + `JOB-10` Warm Paper `@base-ui/react` / `@tanstack/react-table` v9 PWA).

## Container Baseline

- `app`: `node:26` alpine -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `distroless/cc-debian13:nonroot` (~51 MB); `scanner`: `node:26` alpine (~188 MB, `USER 10001:10001`). Digest-pinned, hermetic Swagger UI, `read_only`/`cap_drop: [ALL]`, GHCR `linux/arm64` only.

## Upcoming Priorities

1. Hardening follow-ups: web demo-fallback hiding 404/5xx on settings/commute; Linear Settings display; OAuth callback raw JSON; `needs_reply` inbox filter; Ashby board without public API.
2. Implement `/api/jobs/{id}/tailor` (resume/cover-letter Google Docs grounded in `DATA_DIR` + `project_docs`).
3. Optional Linear sync: backfill `JOB-8`–`JOB-10` in team `JOB` (`JOB-1`–`JOB-7` currently exist).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (`agy` custom agent + deny hook + deny settings + watchdog; stdin prompts; re-run `cli_smoke -- --ignored` after CLI upgrades).
- `JOB-9` capability tiers (`fast`/`balanced`/`deep`, `>= 75.0` escalation) & `auto` equal Claude/Gemini balancing live.
- `JOB-10` Warm Paper + Terracotta mobile-first PWA (`@base-ui/react` primitives, `@tanstack/react-table` v9, 4-Part Fit Horizon, Focus Triage + Undo toast, `⌘K` Quick Capture) synced to `docs/architecture.md` & `README.md`.
- GCP stays in Testing mode; `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` scoped strictly to folder reads; Cloudflare untouched.

## Standing Gotchas

- **Live instance:** compose project `career-os` (`docker compose -p career-os ...`); localhost calls (including `/`) need `Tailscale-User-Login`. Verify live API with `curl`.
- **Stacked PRs + squash merges:** retarget child PR base to `main` *before* merging parent with `--delete-branch` (or GitHub auto-closes child PR); never force-push or rebase pushed branches.
- **Web stack:** `@tanstack/react-table` v9 uses `useTable` + `tableFeatures` + `columnHelper.columns([...])` (not v8 `useReactTable`); Base UI `SheetTitle` overrides `aria-label` on `role="dialog"`.
- SQLite migrations changing `CHECK` constraints (`evaluations`, `ai_usage_events`) require table recreation (`0006_normalize_ai_tiers.sql` pattern).
- `gh pr edit` fails (Projects classic GraphQL) -> use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Auto mode blocks `~/.claude/settings.json` and `automerge` label — ask owner.
- Dependabot: pin Docker tags numerically (`26.13 > 26.9`); Node 26 LTS; Rust `cargo` on `/opt/homebrew/opt/rustup/bin`.
- `agy -p` ignores plain stdin; `permissions.deny` skips `search_web` (PreToolUse hook blocks it).
- Zero PII/secrets in this public repo. Keep replies short (ADHD-friendly): answer/action first, clickable links.
