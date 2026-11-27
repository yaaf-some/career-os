# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-27 · **Linear:** team `JOB` (`Yaaf-Career`), project Mac Mini Rebuild (v1)
**Host:** now on the **M2 Mac mini** (arm64). Installed: claude, agy, Rust 1.100 (Homebrew rustup, PATH in `~/.zshrc`), Docker Desktop. **ai-bridge live under launchd** (`~/.local/bin/career-os-ai-bridge`, `~/Library/LaunchAgents/com.career-os.ai-bridge.plist`, token also in gitignored `.env`).

## Current Focus

- **`JOB-5` Verified + archived 2026-11-27** (`project/changes/archive/JOB-5-ai-bridge/`). #12/#13/#14 merged. AC12 passed on the M2 under Docker Desktop. statusLine hook installed (Usage Bar live).
- **`JOB-6` in progress** (`project/changes/JOB-6-live-google-sync/`, approved 2026-11-27: Q1 `gmail.compose` yes, Q2 Linear yes, Google sync every 12 h). PR A `feat/job-6a-read`: linking, Today, Tracker, quick-add, job comms, Sync now, web read side.
- **Exact Next Concrete Step:** merge PR A after CI, then PR B `feat/job-6b-write` (plan 2.1–2.6: `gmail.compose` scope, Gmail drafts never sent, Calendar reminders), then PR C (Linear).

## Done This Session

- JOB-5 shipped in 3 stacked PRs (#12 → #13 → #14): Rust bridge with tool-less claude/agy (ADR-002), per-request routing/failover, concurrency cap, typed usage; API disabled mode (no silent mock), bridge contract, `ai_routing`, `/api/ai/usage`; web on real routes + typed Usage Bar.

## Container Baseline

- `app`: node:26 alpine (web) → `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` → `distroless/cc-debian13:nonroot`, ~51 MB; `scanner`: node:26 alpine, ~188 MB, `USER 10001:10001`. Bases digest-pinned (Dependabot; patch/minor auto-merge).
- Hermetic build (Swagger UI vendored), `career-os-api --healthcheck`, SIGTERM graceful (app + scanner), compose `read_only`/`cap_drop: [ALL]`/`no-new-privileges`.
- GHCR images **linux/arm64 only** (M2 is the sole target; x86 hosts `docker compose up -d --build`). PR CI container jobs on `ubuntu-24.04-arm` with hadolint v2.15.1, Trivy, smoke tests.

## Upcoming

1. Follow-ups to file: `/api/jobs/{id}/tailor` backend; web demo-fallback still hides 404/5xx on sources/settings/commute routes; hydrogen gives no score breakdown.
2. Kiri: AC12 ran on Docker Desktop; re-check `host.docker.internal:8787` if switching runtime.
3. `JOB-7` Mac mini cutover (compose + `tailscale serve` + launchd).

## Recent Decisions

- ADR-001 split-plane; ADR-002 tool-less bridge (agy: custom agent + deny hook + deny settings + watchdog; prompts on stdin). Re-run `cargo test -p career-os-ai-bridge --test cli_smoke -- --ignored --nocapture` after claude/agy upgrades.
- Tier routing: Settings choose primary CLI per tier (`claude` | `agy` only, Codex/Gemini dropped) + failover toggle, honored per request.
- GCP `Career-Ops` stays in Testing mode. Cloudflare: don't touch.

## Standing Gotchas
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
