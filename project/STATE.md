# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-28 · **Linear:** team `JOB` (`Yaaf-Career`), project Mac Mini Rebuild (v1)
**Host:** now on the **M2 Mac mini** (arm64). Installed: claude, agy, Rust 1.100 (Homebrew rustup, PATH in `~/.zshrc`), Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`, token also in gitignored `.env`).

## Current Focus

- **`JOB-5` Verified + archived 2026-11-27** (`project/changes/archive/JOB-5-ai-bridge/`). #12/#13/#14 merged. AC12 passed on the M2 under Docker Desktop. statusLine hook installed (Usage Bar live).
- **`JOB-6` Verified + archived 2026-11-28** (`project/changes/archive/JOB-6-live-google-sync/`). Google is live on the Mac mini (drafts only, never sent).
- **`JOB-7` Verified + archived 2026-11-28** (`project/changes/archive/JOB-7-mac-mini-cutover/`). Always-on on the Mac mini: compose project `career-os`, tailnet `:8080`, nightly backups (03:30), filtered ATS scans every 3 days, Google sync every 12 h. Old career-ops repo archived.
- **Exact Next Concrete Step:** daily use. Next build candidate: tailoring (resume/cover-letter Docs grounded in `DATA_DIR`, needs a spec), or the follow-ups below.

## Done This Session

- JOB-5 (#12–#14): tool-less host ai-bridge, per-tier routing, live Usage Bar.
- Web job mapping (#15), compose empty encryption-key default (#16).
- JOB-6 (#17–#19, #22): Google sync and linking, Today/Tracker, Gmail drafts (never sent, ADR-003), Calendar reminders, Linear hook, calendar prune/UTC fix.
- JOB-7 (#20, #21): live cutover, importer, nightly backups and restore drill, filtered ATS scans through the sidecar, live Sources page; ~190 scored jobs in the live DB.

## Container Baseline

- `app`: node:26 alpine (web) → `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` → `distroless/cc-debian13:nonroot`, ~51 MB; `scanner`: node:26 alpine, ~188 MB, `USER 10001:10001`. Bases digest-pinned (Dependabot; patch/minor auto-merge).
- Hermetic build (Swagger UI vendored), `career-os-api --healthcheck`, SIGTERM graceful (app + scanner), compose `read_only`/`cap_drop: [ALL]`/`no-new-privileges`.
- GHCR images **linux/arm64 only** (M2 is the sole target; x86 hosts `docker compose up -d --build`). PR CI container jobs on `ubuntu-24.04-arm` with hadolint v2.15.1, Trivy, smoke tests.

## Upcoming

1. Follow-ups to file: web demo-fallback still hides 404/5xx on settings/commute routes; Linear section in Settings shows placeholders; OAuth callback shows raw JSON; hydrogen gives no score breakdown; `needs_reply` flags every synced inbox thread; scanner title filter lets aerospace "Systems Engineer" roles through; one tracked company's Ashby board has no public API.
2. Kiri: AC12 ran on Docker Desktop; re-check `host.docker.internal:8787` if switching runtime.
3. Tailoring (`/api/jobs/{id}/tailor`) is the main missing feature; it needs a new Linear issue and spec.

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (agy: custom agent + deny hook + deny settings + watchdog; prompts on stdin). Re-run `cargo test -p career-os-ai-bridge --test cli_smoke -- --ignored --nocapture` after claude/agy upgrades.
- Tier routing: Settings choose primary CLI per tier (`claude` | `agy` only, Codex/Gemini dropped) + failover toggle, honored per request.
- GCP `Career-Ops` stays in Testing mode. Cloudflare: don't touch.

## Standing Gotchas
- **Live instance:** compose project `career-os` (`docker compose -p career-os …`); the API rejects localhost calls without the `Tailscale-User-Login` header, so script against the tailnet URL. The in-app browser can't load tailnet assets; verify with `curl`.
- **Stacked PRs + squash merges:** merging `origin/main` into the next branch conflicts on lines it re-edited; keep the branch side when it is a superset, confirm `git diff HEAD^1 HEAD` is empty, push. Never rebase.
- Auto mode blocks: editing `~/.claude/settings.json`, adding the `automerge` label. Ask Yaaf for those.
- **Never force-push (incl. `--force-with-lease`), never rebase pushed branches** — merge `origin/main` in instead; others' PRs: `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch`. Never merge without Yaaf's explicit OK.
- `gh pr edit` fails (Projects classic GraphQL) → use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Dependabot: cargo = patch group, web = minor/patch group; 0.x/major bumps arrive singly and need manual migration.
- Pin Docker tags by numeric version sort (26.13 > 26.9).
- Node 26 LTS only. Rust (M2, Homebrew rustup): run `source ~/.zshrc` in a fresh shell to get cargo on PATH.
- agy `-p` never reads plain stdin; `permissions.deny` can't block `search_web` — only the PreToolUse hook can. agy auto-updates: after any claude/agy upgrade re-run `cargo test -p career-os-ai-bridge --test cli_smoke -- --ignored --nocapture`.
- Zero PII/secrets in this public repo (placeholders: `your-user`, `you@example.com`).
- Keep replies short (ADHD): answer/action first, clickable links.
