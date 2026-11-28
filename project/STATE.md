# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Mac Mini Rebuild (v1)`)
**Host:** **M2 Mac mini** (arm64). Installed: `claude`, `agy`, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **Rethink approved (2026-11-28):** job-workspace redesign in 3 stages: `JOB-13` fix basics -> `JOB-14` groundwork (owner approves the look) -> 10 parallel units. Decisions: job workspace home, swipe rebuilt as optional mode, prose files in Google Docs, targeting/skills as app forms, warm + colorful.
- **`JOB-13` (`fix/job-13-basics`):** PR open, awaiting owner merge. After merge: back up, deploy, `POST /api/jobs/backfill-descriptions`, score pending, report AI-skipped count and ask before rescoring them, owner phone check.
- **`JOB-12` live, not archived:** owner has not yet confirmed a real tailor run.

## Active Branches / In-Flight Work

- `main` (`8bb464c`): `JOB-9`–`JOB-12` live on M2 (`tailscale serve` port `8080`; Google OAuth connected, Testing token expires weekly).

## Container Baseline

- `app`: `node:26` alpine -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `distroless/cc-debian13:nonroot` (~51 MB); `scanner`: `node:26` alpine (~188 MB, `USER 10001:10001`). Digest-pinned, hermetic Swagger UI, `read_only`/`cap_drop: [ALL]`, GHCR `linux/arm64` only.

## Upcoming Priorities

1. Ship `JOB-13`, then `JOB-14` (all new migrations land there so parallel units add none).
2. Wave of 10 units (table in `project/changes/JOB-14-job-workspace/` once written); owner invoked `/batch`, so subagents are allowed for this job.
3. Optional: Linear backfill `JOB-8`–`JOB-14`; Ashby `embed: true` is in unit 8.

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (`agy` custom agent + deny hook + deny settings + watchdog; stdin prompts; re-run `cli_smoke -- --ignored` after CLI upgrades).
- `JOB-9` capability tiers (`fast`/`balanced`/`deep`, `>= 75.0` escalation) & `auto` equal Claude/Gemini balancing live.
- `JOB-10` Warm Paper + Terracotta mobile-first PWA (`@base-ui/react`, `@tanstack/react-table` v9, Fit Horizon, Focus Triage + Undo, `⌘K` Quick Capture) synced to `docs/architecture.md` & `README.md`.
- `JOB-11` hardening: live 4xx/5xx over demo fallback, persisted/validated commute prefs, `GET /api/integrations/linear`, OAuth 303 redirect, `needs_reply` automated filter.
- `JOB-12` tailoring: `drive.file` HTML->Google Doc (optional `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`, zero OAuth re-consent), `psych-and-vibe.md` excluded, fail-fast before AI, zero remaining web demo-fallback exceptions.
- GCP stays in Testing mode; `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` strictly read-only; Cloudflare untouched.

## Standing Gotchas

- **Live instance:** compose project `career-os` (`docker compose -p career-os ...`); localhost calls (including `/`) need `Tailscale-User-Login`. Verify live API with `curl`.
- **Stacked PRs + squash merges:** retarget child PR base to `main` *before* merging parent with `--delete-branch` (or GitHub auto-closes child PR); never force-push or rebase pushed branches.
- **Web stack & fixtures:** `@tanstack/react-table` v9 uses `useTable` + `tableFeatures` + `columnHelper.columns([...])`; Base UI `SheetTitle` overrides `aria-label` on `role="dialog"`; changing `JobDetailResponse` requires `UPDATE_FIXTURES=1 cargo test -p career-os-api jobs_fixture`.
- SQLite migrations changing `CHECK` constraints (`evaluations`, `ai_usage_events`) require table recreation (`0006_normalize_ai_tiers.sql` pattern).
- `gh pr edit` fails (Projects classic GraphQL) -> use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`; auto mode blocks `~/.claude/settings.json` and `automerge` label.
- Dependabot: pin Docker tags numerically (`26.13 > 26.9`); Node 26 LTS; Rust `cargo` on `/opt/homebrew/opt/rustup/bin`.
- `agy -p` ignores plain stdin; `permissions.deny` skips `search_web` (PreToolUse hook blocks it); Rust loopback TCP tests need unsandboxed run.
- E2E: `cd e2e && npm test` (Playwright, synthetic data, ports 18100+; needs `web` built). Never point it at 8080/8787.
- Zero PII/secrets in this public repo. Keep replies short (ADHD-friendly): answer/action first, clickable links.
