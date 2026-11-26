# Project State (Elephant Handoff — career-os)

**Last updated:** 2026-11-26
**Active Linear Team:** `JOB` (`Yaaf-Career`)

## Current Focus

- **Phase 2 (`JOB-4`) DONE:** PR #4 squash-merged (`0f7d201`); GHCR release green (native amd64 + arm64, Cosign-signed, SLSA-attested).
- **Dependency cleanup:** PR #5 (`chore/rust-deps-major`) = tower-http 0.7, aes-gcm 0.11, base64 0.23, rand 0.10 (`crypto.rs` migrated to `SysRng` + `Nonce::from/try_from`) + jsdom 31, TypeScript 7.0.2, `@hey-api/openapi-ts` pinned `^0.99.0` (was `latest`). Supersedes closed PRs #2/#3 and Dependabot singles #7–#10.
- **Exact Next Concrete Step:** Merge PR #5 when `CI Gate` is green (Dependabot then auto-closes #7–#10), mark `JOB-4` Done in Linear, then start `JOB-5` via `project-propose`.

## Container Baseline (as of PR #4)

- `app`: `node:26.x-alpine3.23` (web build) -> `cargo-chef:0.1.78-rust-1.100.0-slim-trixie` -> `gcr.io/distroless/cc-debian13:nonroot`; ~51 MB; all bases tag+digest pinned (Dependabot bumps; patch/minor auto-merge on green CI, e.g. PR #6).
- Hermetic build: `utoipa-swagger-ui` `vendored` feature (no curl/network in `build.rs`).
- Runtime: UID 65532, root-owned read-only binary/assets, writable `/var/lib/career-os` (VOLUME, default `DATABASE_URL`), `career-os-api --healthcheck`, SIGTERM graceful shutdown (app + scanner).
- `scanner`: `node:26.x-alpine3.23`, npm/npx/corepack removed, `USER 10001:10001` (hadolint DL3066 needs numeric), ~188 MB.
- Compose: `read_only`, tmpfs `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, healthchecks.
- PR CI container jobs run on native `ubuntu-24.04-arm` (Mac mini parity): hadolint v2.15.1 + Trivy + smoke tests (non-root, read-only, healthy, exit 0 on SIGTERM).

## Upcoming High-Priority Changes

1. **`JOB-5` (Phase 3):** Host `ai-bridge` macOS `launchd` daemon (`claude -p` / `agy -p`), tier routing (`hydrogen`/`neon`), live Usage Bar.
2. **`JOB-6` (Phase 4):** Live Google Workspace sync (Gmail/Drive/Calendar), Linear ops, Tokio scheduler.
3. **`JOB-7` (Phase 5):** Mac mini cutover (`docker compose` + `tailscale serve` + `launchd`) & retire `yaaf-some/yaaf-career-ops`.
4. Optional: shrink scanner image (distroless Node) if size matters.

## Recent Decisions

- **ADR-001:** Split-plane `app` + `scanner` + host `ai-bridge`; image hardening recorded there.
- **GCP `Career-Ops`:** Intentionally in **Testing mode** (7-day OAuth re-sign-in). Maps + Places APIs enabled.
- **Cloudflare:** All career-ops resources deleted (DNS kept); do NOT touch Cloudflare MCP.

## Standing Gotchas

- **Never force-push (incl. `--force-with-lease`); always PRs.** To catch a pushed branch up with `main`, *merge* `origin/main` into it (never rebase pushed history); for others' PRs use `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch`. `Protect main` requires `CI Gate`, squash, up-to-date branch. Never merge without Yaaf's approval.
- **Dependabot groups:** cargo = patch-only group, web = minor/patch group; 0.x/major bumps arrive as single PRs and need manual migration.
- **Docker tag pinning:** sort versions numerically (26.13 > 26.9).
- **Node 26 LTS only** (never Node 20/22). Local Rust: `export PATH=$HOME/.cargo/bin:$PATH`.
- **Zero PII/secrets** in public `career-os` (`HOME_LOCATION_AREA` is neighborhood/city only).
- **Keep replies short** (ADHD): answer/action first, clickable links.
