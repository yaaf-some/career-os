# Glossary

- **ai-bridge:** Host-side HTTP daemon managed by macOS `launchd` (`127.0.0.1:8787`) that accepts authenticated prompts from `career-os-api` via `host.docker.internal` and invokes `claude -p` or `agy -p`.
- **ALLOWED_TAILSCALE_USER:** Environment variable specifying the single Tailscale user login email authorized to access `career-os-api`.
- **ATS (Applicant Tracking System):** External recruiting platform (e.g., Greenhouse, Lever, Ashby) queried by `scanner` for open roles.
- **career-os-api:** The Rust/Axum backend binary compiled in Stage 2 of `Dockerfile` and executed inside the distroless container.
- **DATA_DIR:** Host directory containing private candidate source files (resume facts, profile, writing samples), mounted read-only into the `app` container at `/data`.
- **Elephant / Goldfish workflow:** Cross-session project discipline where `project/STATE.md` holds compact handoff context (Elephant) while implementation tasks execute in focused, bounded contexts (Goldfish).
- **scanner:** The isolated `node:22-alpine` sidecar container (`scanner.Dockerfile`, port `8081`) dedicated to deterministic job-portal fetching and liveness checks.
- **Tailscale Serve:** Tailscale reverse proxy terminating TLS for the tailnet and forwarding authenticated identity headers to `127.0.0.1:8080`.
- **TOKEN_ENCRYPTION_KEY:** 32-byte base64 key used by `career-os-api` to encrypt Google OAuth refresh/access tokens at rest in SQLite.
