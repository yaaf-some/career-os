# Project State (career-os)

- **Active Goal:** Phase 2 (`JOB-4`) — Google OAuth 7-day Testing-mode reconnect UX + LA Commute & Distance (Maps + Places API)
- **Linear Team:** `JOB` (`Yaaf-Career`) · Milestone `Mac Mini Rebuild (v1)` (`JOB-1..7`)
  - `JOB-1` In Progress: Mac mini self-hosted rebuild
  - `JOB-2` Done: Phase 0 cleanup, `yaaf-career-data` private repo, GCP `Career-Ops` setup
  - `JOB-3` Done: Phase 1 bootstrap, stack CI/CD (`CI Gate`, Node 26 LTS, `rust:1-trixie` -> `debian:trixie-slim`), Cosign/SLSA CD, `Protect main` ruleset (PR #1 merged)
  - `JOB-4` In Progress: Phase 2 Google OAuth 7d Testing-mode UX & LA Commute (`feat/job-4-maps-commute-and-oauth-ux` -> PR #2)
  - `JOB-5..7` Todo: Host `ai-bridge` (`claude -p`/`agy -p`), live Google/Linear sync & scheduler, Mac mini cutover
- **Key Guardrails:**
  - GCP `Career-Ops` stays intentionally in **Testing mode** (weekly 7-day OAuth re-sign-in; UI `<24h` warning + 1-click reconnect).
  - `HOME_LOCATION_AREA` uses neighborhood/city only (e.g. `West Los Angeles, CA`); never store street addresses, phone numbers, or PII in `career-os`.
  - Node 26 LTS (`node:26-alpine`), PR-only (`CI Gate` required), never force-push.
