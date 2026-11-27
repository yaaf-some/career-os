# Glossary

- **agy:** The Antigravity CLI. One of the two CLIs the ai-bridge can run (the other is Claude Code, `claude`).
- **ai-bridge:** Rust HTTP daemon (`crates/ai-bridge`) on the macOS host, managed by `launchd` (`127.0.0.1:8787`). Accepts authenticated prompts from `career-os-api` via `host.docker.internal` and runs `claude` or `agy` with no tools (see ADR-002).
- **ai_routing:** Setting (`PUT /api/settings/ai_routing`) choosing the primary CLI for hydrogen and neon (carbon follows neon) and whether failover is allowed.
- **ALLOWED_TAILSCALE_USER:** Environment variable specifying the single Tailscale user login email authorized to access `career-os-api`.
- **ATS (Applicant Tracking System):** External recruiting platform (e.g., Greenhouse, Lever, Ashby) queried by `scanner` for open roles.
- **career-os-api:** The Rust/Axum backend binary compiled in the `rust-builder` stage of `Dockerfile` and executed inside the distroless container.
- **DATA_DIR:** Host directory containing private candidate source files (resume facts, profile, writing samples), mounted read-only into the `app` container at `/data`.
- **Disabled AI mode:** API state when no bridge URL + token is set and demo mode is off: AI routes return 503 and the scheduler skips scoring (no silent mock).
- **Elephant / Goldfish workflow:** Cross-session project discipline where `project/STATE.md` holds compact handoff context (Elephant) while implementation tasks execute in focused, bounded contexts (Goldfish).
- **Failover:** The bridge retrying on the other CLI after the primary is rate-limited, times out, is missing, or attempts a tool. Generic CLI errors do not fail over.
- **hydrogen / neon / carbon:** AI tiers: hydrogen = fast batch triage scoring, neon = deep single-job evaluation, carbon = reserved heavier tier.
- **scanner:** The isolated `node:26-alpine` sidecar container (`scanner.Dockerfile`, port `8081`) dedicated to deterministic job-portal fetching and liveness checks.
- **Statusline file:** JSON that Claude Code's `statusLine` command writes to `CLAUDE_STATUSLINE_PATH`; the bridge reads its `rate_limits` for the 5 h / 7 d Usage Bar windows.
- **Tailscale Serve:** Tailscale reverse proxy terminating TLS for the tailnet and forwarding authenticated identity headers to `127.0.0.1:8080`.
- **TOKEN_ENCRYPTION_KEY:** 32-byte base64 key used by `career-os-api` to encrypt Google OAuth refresh/access tokens at rest in SQLite.
