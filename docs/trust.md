# Trust & Security Model

`career-os` operates under three strict trust boundaries: network/identity isolation, secret & PII separation, and untrusted external content handling.

## 1. Network & Identity Boundary

- **Tailscale identity enforcement:** `career-os-api` binds only to loopback on the host (`127.0.0.1:8080`) and expects `tailscale serve` in front of it. Requests must match `ALLOWED_TAILSCALE_USER` via the Tailscale identity header (except unauthenticated liveness probes if explicitly configured).
- **Sidecar isolation:** `scanner` exposes port `8081` only on the internal Docker network (`expose`, never `ports`), preventing direct external access.
- **Bridge authentication:** `ai-bridge` listens on `127.0.0.1:8787` on the host and rejects requests lacking a valid `Authorization: Bearer <AI_BRIDGE_TOKEN>` header.

## 2. Secret & PII Hygiene

- **Public repo rule:** Zero PII (real emails, phone numbers, physical addresses, personal domains) and zero credentials may be committed to git.
- **Automated scanning:** `.gitleaks.toml` and the `security` CI job scan commits for leaked tokens and secrets while allowlisting explicit documented placeholders (`.env.example`, `deploy/launchd/*.plist.example`).
- **Encrypted OAuth storage:** Google OAuth tokens are encrypted at rest in SQLite using `TOKEN_ENCRYPTION_KEY` (32-byte base64 key) rather than stored in plaintext.

## 3. Untrusted External Content & Source-of-Truth

- **Data, never instructions:** Job descriptions, company career pages, ATS payloads, and inbound recruiter emails fetched by `scanner` or Gmail sync are untrusted inputs. They may inform scoring and summaries, never trigger shell commands, state mutations outside normal API flows, or override system instructions.
- **Zero fabrication:** Generated CVs, cover letters, and outreach drafts must derive factual claims exclusively from verified candidate source files in `DATA_DIR` (`/data:ro`) and explicit user input.
