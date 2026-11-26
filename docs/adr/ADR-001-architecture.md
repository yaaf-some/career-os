# ADR-001: Split-Plane Container & Host Bridge Architecture

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

`career-os` needs to run 24/7 on a personal Apple Silicon Mac mini (or Linux host), remain securely reachable from mobile devices via a React 19 PWA, isolate untrusted job-board scraping, and leverage local AI coding CLIs (`claude -p`, `agy -p`) without embedding long-lived LLM API keys inside network-facing containers.

## Decision

Adopt a three-part runtime architecture:

1. **`app` container (`crates/` + `web/`):**
   - Built via multi-stage `Dockerfile` (`node:26-alpine` -> `cargo-chef` Debian 13 Trixie -> `gcr.io/distroless/cc-debian13:nonroot`).
   - Image hardening: base images pinned by tag + digest (Dependabot-managed), hermetic build (Swagger UI vendored, no network in `build.rs`), root-owned read-only binary/assets with only `/var/lib/career-os` writable, built-in `career-os-api --healthcheck` (no shell needed), SIGTERM graceful shutdown, and compose runs with `read_only`, `cap_drop: [ALL]`, `no-new-privileges`. CI smoke-tests both images natively on `linux/arm64`.
   - Rust/Axum serves both the REST API and static React 19 PWA assets (`STATIC_DIR=/app/static`), backed by SQLite in WAL mode on a persistent volume (`career_os_db`).
   - Binds to `127.0.0.1:8080` behind `tailscale serve` and enforces `ALLOWED_TAILSCALE_USER`.
2. **`scanner` sidecar container (`scanner/`):**
   - Runs `node:26-alpine` as a non-root user on port `8081` (`scanner.Dockerfile`), exposed only on the internal Docker Compose network.
   - Isolates HTTP/HTML parsing of untrusted external ATS boards from the database and OAuth secrets.
3. **Host `ai-bridge` (`deploy/launchd/`):**
   - Managed by macOS `launchd` on `127.0.0.1:8787` and reached from `app` via `host.docker.internal:8787` using a shared bearer token (`AI_BRIDGE_TOKEN`).
   - Invokes local CLI agents (`claude -p` / `agy -p`) directly on the host without exposing host filesystem credentials or raw API keys to containers.

## Consequences

- **Positive:** Minimal attack surface (distroless non-root runtime, loopback binding, Tailscale auth), fast SQLite WAL performance without external DB services, clean separation between scraping and core state, and seamless reuse of local CLI agent subscriptions.
- **Negative / Trade-offs:** Requires a host-side `launchd` daemon on macOS (or systemd unit on Linux) for AI-assisted workflows; single-node SQLite WAL limits horizontal scaling (acceptable for a single-user OS).
