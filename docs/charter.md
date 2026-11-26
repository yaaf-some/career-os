# Charter

`career-os` is a self-hosted, single-user job-search operating system designed to run continuously on personal hardware (Apple Silicon Mac mini or Linux host) via Docker Compose and Tailscale.

## Mission

Give a single candidate full ownership of their job-search pipeline—discovery, evaluation, tailored artifact generation, application tracking, and reply monitoring—with mobile-first accessibility, zero cloud multi-tenancy, and strict factual grounding.

## Core Principles

1. **Single-user sovereignty:** All state lives in a local SQLite WAL database and user-owned data directory. No external SaaS database or shared tenant storage.
2. **Zero-trust tailnet ingress:** The application binds only to `127.0.0.1:8080` and delegates authentication to `tailscale serve` identity headers (`ALLOWED_TAILSCALE_USER`).
3. **Host-delegated AI:** LLM inference is never baked into the server with raw long-lived API keys in untrusted containers; instead, a localhost host bridge (`ai-bridge`) invokes local CLI agents (`claude -p`, `agy -p`).
4. **Zero fabrication:** Candidate resumes, cover letters, and interview prep must trace strictly to verified user-authored source files.
5. **Public code, private data:** The repository contains zero personal information, candidate files, or credentials; personal data is mounted read-only at runtime (`DATA_DIR`).

## Non-Goals

- Multi-tenant SaaS hosting, team RBAC, or billing.
- Autonomous job submission or email sending without explicit human confirmation.
- Scraping behind anti-bot/CAPTCHA walls or bypassing platform access controls.
