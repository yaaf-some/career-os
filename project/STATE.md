# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Mac Mini Rebuild (v1)`)
**Host:** **M2 Mac mini** (arm64). Installed: `claude`, `agy`, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **`JOB-11` Shipped, Verified & Archived:** PR `#36` merged to `main` (`d952d56`), `career-os-app` deployed live on M2 (`Release Container Images` `46170896112`), verified via live endpoints, and archived under `project/changes/archive/JOB-11-hardening-followups/`.
- **Exact Next Concrete Step:** merge `docs/job-11-verify-archive`, then propose (`project-propose`) `JOB-12` (`/api/jobs/{id}/tailor`: resume/cover-letter Google Docs grounded in `DATA_DIR` + `project_docs`) or Ashby `embed: true` source opt-in.

## Active Branches / In-Flight Work

- `main` (`d952d56`): `JOB-9`–`JOB-11` live on M2 (`ai-bridge` + `career-os-app`).
- `docs/job-11-verify-archive`: archives `JOB-11` and refreshes `project/STATE.md` (awaiting owner merge approval).

## Container Baseline

- `app`: `node:26` alpine -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `distroless/cc-debian13:nonroot` (~51 MB); `scanner`: `node:26` alpine (~188 MB, `USER 10001:10001`). Digest-pinned, hermetic Swagger UI, `read_only`/`cap_drop: [ALL]`, GHCR `linux/arm64` only.

## Upcoming Priorities

1. Implement `/api/jobs/{id}/tailor` (`JOB-12`: resume/cover-letter Google Docs grounded in `DATA_DIR` + `project_docs`).
2. Expose Ashby `embed: true` opt-in on `career-os` sources (scanner already supports it; deferred from `JOB-11`).
3. Optional Linear sync: backfill `JOB-8`–`JOB-11` in team `JOB` (`JOB-1`–`JOB-7` currently exist).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (`agy` custom agent + deny hook + deny settings + watchdog; stdin prompts; re-run `cli_smoke -- --ignored` after CLI upgrades).
- `JOB-9` capability tiers (`fast`/`balanced`/`deep`, `>= 75.0` escalation) & `auto` equal Claude/Gemini balancing live.
- `JOB-10` Warm Paper + Terracotta mobile-first PWA (`@base-ui/react` primitives, `@tanstack/react-table` v9, 4-Part Fit Horizon, Focus Triage + Undo toast, `⌘K` Quick Capture) synced to `docs/architecture.md` & `README.md`.
- `JOB-11` hardening: live 4xx/5xx over demo fallback (`tailor` excepted until `JOB-12`), persisted/validated commute prefs, `GET /api/integrations/linear`, OAuth 303 redirect, `needs_reply` automated filter.
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
