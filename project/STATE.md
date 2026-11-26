# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-26 · **Linear:** team `JOB` (`Yaaf-Career`), project Mac Mini Rebuild (v1)
**Host:** now on the **M2 Mac mini** (arm64). Installed: claude, agy, Rust 1.100 (Homebrew rustup). Not yet: Kiri (needed for AC12 only).

## Current Focus

- **`JOB-5` (Phase 3) — APPROVED 2026-11-26, executing PR A** on `feat/job-5a-bridge` (`project/changes/JOB-5-ai-bridge/{spec.md,plan.md}`). Task 1.2 done (CLI contracts + fixtures; agy lockdown = custom agent + PreToolUse deny hook + deny settings + watchdog — see plan Execution Notes).
- **Exact Next Concrete Step:** `project-execute` task **1.1** (config hardening), then 1.3–1.7, 1.8 opens PR A. Delegate `[haiku]` tasks one per subagent (Goldfish; subagents never commit/push).

## Done This Session

- JOB-4 merged (PR #4) + container hardening; deps PR #5; Node bump #6 (auto-merge); arm64-only releases (#11). Closed #2, #3, #7–#10. No open PRs. JOB-4 is Done in Linear.
- JOB-5 research via 3 Haiku agents; findings are in `spec.md` "Problem / Context".

## Container Baseline

- `app`: node:26 alpine (web) → `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` → `distroless/cc-debian13:nonroot`, ~51 MB; `scanner`: node:26 alpine, ~188 MB, `USER 10001:10001`. Bases digest-pinned (Dependabot; patch/minor auto-merge).
- Hermetic build (Swagger UI vendored), `career-os-api --healthcheck`, SIGTERM graceful (app + scanner), compose `read_only`/`cap_drop: [ALL]`/`no-new-privileges`.
- GHCR images **linux/arm64 only** (M2 is the sole target; x86 hosts `docker compose up -d --build`). PR CI container jobs on `ubuntu-24.04-arm` with hadolint v2.15.1, Trivy, smoke tests.

## Upcoming

1. JOB-5 PR A (bridge + plist + macOS CI) → PR B (API contract, no silent mock) → PR C (web + docs) → host acceptance AC12 on the M2 under Kiri.
2. Follow-ups to file: `/api/jobs/{id}/tailor` backend; web demo-fallback hides 404/5xx in live mode.
3. `JOB-6` Live Google sync + scheduler · `JOB-7` Mac mini cutover (compose + `tailscale serve` + launchd).

## Recent Decisions

- ADR-001 split-plane `app` + `scanner` + host `ai-bridge` (Rust crate `crates/ai-bridge`, NOT Node — docs say Node, fix in PR C).
- Tier routing: Settings choose primary CLI per tier (`claude` | `agy` only, Codex/Gemini dropped) + failover toggle, honored per request.
- GCP `Career-Ops` stays in Testing mode. Cloudflare: don't touch.

## Standing Gotchas

- **Never force-push (incl. `--force-with-lease`), never rebase pushed branches** — merge `origin/main` in instead; others' PRs: `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch`. Never merge without Yaaf's explicit OK.
- `gh pr edit` fails (Projects classic GraphQL) → use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- Dependabot: cargo = patch group, web = minor/patch group; 0.x/major bumps arrive singly and need manual migration.
- Pin Docker tags by numeric version sort (26.13 > 26.9).
- Node 26 LTS only. Rust (M2, Homebrew rustup, keg-only): `export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH`.
- agy `-p` never reads plain stdin; `permissions.deny` can't block `search_web` — only the PreToolUse hook can. agy auto-updates: re-run the ignored agy smoke test after upgrades.
- Zero PII/secrets in this public repo (placeholders: `your-user`, `you@example.com`).
- Keep replies short (ADHD): answer/action first, clickable links.
