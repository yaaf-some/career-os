# Project State

Last updated: 2026-11-26

## Current Focus

- **Phase 1 -> Phase 2 Transition:** Repository scaffolding, CI/CD pipelines, Docker Compose topology, cross-agent skills, and living docs are established. Next: wire end-to-end API routes, SQLite WAL migrations, React 19 PWA views, and scanner integration tests.

## Active Branches / In-Flight Work

- `main`: Initial Phase 1 scaffold (`crates/`, `web/`, `scanner/`, `deploy/`, `docs/`, `.github/`).

## Upcoming Priorities

1. Complete Phase 2 core API endpoints in `crates/` (applications CRUD, SQLite WAL migrations, Tailscale user guard, health checks).
2. Implement `web/` PWA dashboard, pipeline inbox, and mobile-first evaluation views.
3. Connect `scanner` sidecar (`/health`, ATS fetch endpoints) with `career-os-api`.
4. Validate host `ai-bridge` (`deploy/launchd/`) end-to-end with `claude -p` / `agy -p`.
5. Run full `docker compose build` + CI parity checks across Rust, Web, Scanner, and Gitleaks.

## Recent Decisions

- [ADR-001](../docs/adr/ADR-001-architecture.md): Rust/Axum + SQLite WAL core, React 19 PWA, internal Node scanner container, macOS host `ai-bridge`, and Tailscale Serve single-user auth.

## Standing Gotchas

- **Public repo hygiene:** Never commit PII, real emails, personal Tailscale hostnames, or secrets; CI enforces `gitleaks` against `.gitleaks.toml`.
- **Distroless runtime:** `Dockerfile` uses `gcr.io/distroless/cc-debian12:nonroot`; avoid shell-dependent startup scripts and pass configuration via environment variables.
