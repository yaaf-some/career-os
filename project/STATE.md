# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Yaaf-Career`), project Mac Mini Rebuild (v1)
**Host:** **M2 Mac mini** (arm64). Installed: claude, agy, Rust 1.100, Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`).

## Current Focus

- **`JOB-7` Verified + archived 2026-11-28** (`project/changes/archive/JOB-7-mac-mini-cutover/`): always-on compose `career-os`, tailnet `:8080`, nightly backups, old repo archived.
- **`JOB-8` Verified + archived 2026-11-28** (`project/changes/archive/JOB-8-profile-scoring-drive-sync/`): #24/#25/#26 merged; profile loader, 4-dim breakdown, profile scanner filters, `drive.readonly` Project Docs sync, Maps (`routes_api`), and Linear (`JOB`) live on M2.
- **Exact Next Concrete Step:** review & approve proposed specs for **`JOB-9`** (auto AI capability tiers + equal Claude/Gemini balancing) and **`JOB-10`** (ADHD-friendly Calm Native iOS/macOS UI overhaul), then execute `JOB-9` PR A.

## Done This Session

- JOB-5/6/7 (#12–#23): tool-less host `ai-bridge` + Usage Bar, live Google Workspace sync/drafts/calendar, M2 Docker cutover + filtered ATS scanner.
- JOB-8 (#24–#26): `/data/profile` loader (`~/career-data`), scanner pre-filters, 4-dim breakdown, `drive.readonly` `project_docs` sync, bulk rescore (`100` -> `54` triage), Maps & Linear live.

## Container Baseline

- `app`: node:26 alpine (web) → `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` → `distroless/cc-debian13:nonroot`, ~51 MB; `scanner`: node:26 alpine, ~188 MB, `USER 10001:10001`. Bases digest-pinned (Dependabot).
- Hermetic build (Swagger UI vendored), `--healthcheck`, SIGTERM graceful, compose `read_only`/`cap_drop: [ALL]`/`no-new-privileges`.
- GHCR **linux/arm64 only**; PR CI container jobs on `ubuntu-24.04-arm` (hadolint v2.15.1, Trivy, smoke tests).

## Upcoming

1. **`JOB-9` (Proposed):** `project/changes/JOB-9-auto-ai-routing/` — replace Antigravity codenames with automatic `fast`/`balanced`/`deep` tiers (`>= 75` escalation) + quota-aware equal Claude/Gemini routing.
2. **`JOB-10` (Proposed):** `project/changes/JOB-10-calm-native-ui/` — ADHD-friendly Calm Native iOS/macOS UX/UI overhaul (`@base-ui/react` + `coss ui` primitives + TanStack Table, Focus Triage, `⌘K`).
3. Remaining follow-ups: web demo-fallback hides 404/5xx on settings/commute; Linear Settings display; OAuth callback shows raw JSON; `needs_reply` inbox filter; Ashby board with no public API.
4. Future build candidate: `/api/jobs/{id}/tailor` (resume/cover-letter Docs grounded in `DATA_DIR` + `project_docs`).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (agy: custom agent + deny hook + deny settings + watchdog; prompts on stdin). Re-run `cli_smoke -- --ignored` after claude/agy upgrades.
- GCP stays in Testing mode; `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` scoped strictly to folder reads; Cloudflare untouched.

## Standing Gotchas

- **Live instance:** compose project `career-os` (`docker compose -p career-os …`); localhost calls need `Tailscale-User-Login`. Verify live API with `curl`.
- **Stacked PRs + squash merges:** merge `origin/main` (keep branch superset on conflict); **never force-push, never rebase pushed branches, never merge without Yaaf's OK.**
- `gh pr edit` fails (Projects classic GraphQL) → use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Auto mode blocks: `~/.claude/settings.json`, `automerge` label. Ask Yaaf for those.
- Dependabot: cargo patch group, web minor/patch group; 0.x/major need manual migration. Pin Docker tags numerically (`26.13 > 26.9`). Node 26 LTS only; Rust `cargo` on Homebrew PATH.
- agy `-p` ignores plain stdin; `permissions.deny` skips `search_web` (PreToolUse hook blocks it).
- Zero PII/secrets in this public repo. Keep replies short (ADHD): answer/action first, clickable links.
