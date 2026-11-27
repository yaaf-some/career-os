# Trust & Security Model

`career-os` operates under three strict trust boundaries: network/identity isolation, secret & PII separation, and untrusted external content handling.

## 1. Network & Identity Boundary

- **Tailscale identity enforcement:** `career-os-api` binds only to loopback on the host (`127.0.0.1:8080`) and expects `tailscale serve` in front of it. Requests must match `ALLOWED_TAILSCALE_USER` via the Tailscale identity header (except unauthenticated liveness probes if explicitly configured).
- **Sidecar isolation:** `scanner` exposes port `8081` only on the internal Docker network (`expose`, never `ports`), preventing direct external access.
- **Bridge authentication:** `ai-bridge` listens on `127.0.0.1:8787` on the host and rejects requests lacking a valid `Authorization: Bearer <AI_BRIDGE_TOKEN>` header (constant-time compare). It refuses to start if the token is missing, shorter than 32 characters, or a placeholder. Only `/healthz` is unauthenticated, and it reports booleans only (no paths, no CLI output).
- **Bridge errors don't impersonate user auth:** a bridge 401/400 reaches the browser as a 502, never as a 401.

## 2. Secret & PII Hygiene

- **Public repo rule:** Zero PII (real emails, phone numbers, physical addresses, personal domains) and zero credentials may be committed to git.
- **Automated scanning:** `.gitleaks.toml` and the `security` CI job scan commits for leaked tokens and secrets while allowlisting explicit documented placeholders (`.env.example`, `deploy/launchd/*.plist.example`).
- **Encrypted OAuth storage:** Google OAuth tokens are encrypted at rest in SQLite using `TOKEN_ENCRYPTION_KEY` (32-byte base64 key) rather than stored in plaintext.
- **Google scopes:** `gmail.readonly`, `gmail.compose`, `drive.file`, `calendar.events` and `userinfo.email`. Gmail is **drafts only**: the API creates and updates drafts and never sends; you send from Gmail ([ADR-003](adr/ADR-003-gmail-drafts-never-send.md)). Calendar reminders are created only when you click **Add Calendar Reminder**.

## 3. Untrusted External Content & Source-of-Truth

- **Data, never instructions:** Job descriptions, company career pages, ATS payloads, and inbound recruiter emails fetched by `scanner` or Gmail sync are untrusted inputs. They may inform scoring and summaries, never trigger shell commands, state mutations outside normal API flows, or override system instructions.
- **Synced email and calendar text:** Gmail subjects, senders and snippets, and Calendar titles, are untrusted. They are only compared as plain strings to link them to applications. They are never sent to an AI model, executed, or used to change state other than the link. A wrong auto-link can be corrected by hand, and manual links persist.
- **Zero fabrication:** Generated CVs, cover letters, and outreach drafts must derive factual claims exclusively from verified candidate source files in `DATA_DIR` (`/data:ro`) and explicit user input.

## 4. Host AI CLI Isolation (ADR-002)

The bridge sends untrusted job text to CLIs that normally have tools (shell, file access, web search). It runs them as text-only completion engines:

- **No tools:** claude runs with `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--disable-slash-commands`. agy runs a custom agent with `tools: []` and `excludeDefaultComponents`, a `PreToolUse` hook that denies every tool (including server-side `search_web`), `permissions.deny` for all tool classes, `--sandbox --mode plan`, and a stream watchdog that kills the run on any tool step (`TOOL_USE_BLOCKED`).
- **Prompt never in argv:** the prompt goes on stdin; claude's system prompt goes through a 0600 temp file that is deleted after the run. `ps` shows no prompt text.
- **Minimal environment:** child processes get only `PATH HOME USER LANG TMPDIR` and run in a private 0700 workdir.
- **No conversation history left behind:** agy's saved conversation (`~/.gemini/antigravity-cli/brain/<uuid>`) is deleted after every run; claude runs with `--no-session-persistence`.
- **No mock outside demo:** without a bridge URL + token (and `AI_DEMO_MODE` off), the API returns 503 for AI routes instead of fabricated scores, and the web shows the error instead of demo output.
- **Re-verify after CLI upgrades:** `cargo test -p career-os-ai-bridge --test cli_smoke -- --ignored --nocapture`.

## 5. Repository & CI/CD Governance

- **Protected `main` Ruleset:** Direct pushes, deletions, and force-pushes (`non_fast_forward`) are blocked on `main`. All merges require squash-only linear history and a passing `CI Gate` check.
- **Supply-Chain Hardening:** Every third-party GitHub Action is pinned to an immutable 40-character commit SHA, `actions/checkout` disables credential persistence (`persist-credentials: false`), workflows are audited by `actionlint` + `zizmor`, containers are linted (`hadolint`) and scanned (`Trivy`), and published GHCR images receive SBOMs, SLSA provenance attestations, and keyless Cosign OIDC signatures.
