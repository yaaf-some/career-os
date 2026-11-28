# JOB-7 — Mac mini cutover: always-on stack, tailnet access, data migration, retire the old career-ops repo

**Status:** Proposed 2026-11-28 (Yaaf: "Yes, start it"; open questions below)
**Issue:** JOB-7 (Linear, no description) · Parent JOB-1 · Branch `feat/job-7-cutover` · Also closes JOB-6 AC11 (live Google check)

## Problem / Context

Everything so far ran in throwaway compose projects on this M2 Mac mini (`your-mac-mini.your-tailnet.ts.net`). There is no persistent install you can open from your phone. Current state:

- **Host.**
  - Docker Desktop is the active context and starts at login (`AutoStart: true`).
  - The ai-bridge runs under launchd.
  - Images are published to GHCR from `main` (`release-images.yml`) and pull fine.
- **Tailscale.**
  - `tailscale serve` already maps `https://your-mac-mini.your-tailnet.ts.net:8080` → `http://127.0.0.1:8080`.
  - `/` already serves another local service. Leave it alone.
  - Other users' devices are on the tailnet, so `ALLOWED_TAILSCALE_USER` must be set to your login. The compose default `you@example.com` would lock you out.
- **`.env`** sets only `AI_BRIDGE_URL`, `AI_BRIDGE_TOKEN` and `TOKEN_ENCRYPTION_KEY`. Not set: `ALLOWED_TAILSCALE_USER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DATA_DIR`, `GOOGLE_MAPS_API_KEY`, `LINEAR_*`.
- **Old system.** the old career-ops repo (private repo) ran on a private career-data repo, which holds:
  - `portals.yml`: 58 tracked companies with careers URLs or ATS APIs, plus title, location and experience filters;
  - `data/pipeline.md`: 36 pending job URLs;
  - `data/applications.md`: empty;
  - `cv.md`, `data/master-resume-draft.md`, `config/profile.yml`: source files for future tailoring.

  The app doesn't read `/data` yet; only the tailoring feature will.
- **No backups.** All state is one SQLite file in the `career_os_db` Docker volume.

## Goals

1. **Always on.**
   - A compose project named `career-os` runs from the GHCR `latest` images (`docker compose pull && up -d`, no local build), with `restart: unless-stopped`. It comes back after a reboot without manual steps (Docker Desktop autostart, then containers restart).
   - The bridge stays under launchd.
2. **Tailnet only.**
   - Reachable at `https://your-mac-mini.your-tailnet.ts.net:8080` (the existing serve mapping; the `/` mapping for another service is unchanged).
   - `ALLOWED_TAILSCALE_USER` = your Tailscale login, so other tailnet users get 403.
   - Port `127.0.0.1:8080` is never exposed beyond loopback.
3. **Private data mounted.** the private career-data repo is cloned to `~/career-data` and mounted read-only as `DATA_DIR`. It is never copied into this repo.
4. **Old pipeline migrated.**
   - Import `portals.yml` tracked companies as Sources (`POST /api/sources`, keeping enabled flags).
   - Ingest the 36 pending `pipeline.md` URLs as manual jobs (`POST /api/jobs/ingest`, with company, title and location from each line).
   - The importer is a committed script, `scripts/import-career-ops.mjs`, with zero data in the repo. It reads the files from `DATA_DIR`, runs against the live API, and is idempotent (re-running adds no duplicates).
5. **Google live (JOB-6 AC11).**
   - `GOOGLE_REDIRECT_URI` = `https://your-mac-mini.your-tailnet.ts.net:8080/api/auth/google/callback`.
   - Connect, Sync now, check a linked thread, then save a real Gmail draft (unsent) and a real Calendar reminder.
6. **Backups.**
   - A launchd job runs nightly (`deploy/launchd/com.career-os.backup.plist.example` plus `scripts/backup-db.sh`).
   - It makes an online SQLite `.backup` of the volume into `~/Backups/career-os/`, keeps 14 days, and integrity-checks each file.
   - A restore procedure is documented and tested once.
7. **Retire the old career-ops repo.** After Goals 1–5 pass, archive the GitHub repo (read-only and reversible), keeping the private career-data repo. Nothing from it runs on this host.
8. **Filtered scanning** (added 2026-11-28, Yaaf: "Yes, both").
   - ATS scans go through the scanner sidecar's `/scan/ats`: provider registry, posting guard, and the target title, location and experience filters, plus a 45-day posting age.
   - Accepted postings are ingested with their `source_id`. Rejected ones go to `filtered_audit` with the reason. Per-source errors go to `sources.last_error`.
   - Without `SCANNER_URL`, scans return 503 instead of ingesting unfiltered postings.
   - The Sources page works live: it lists sources with their matched counts, has an on/off switch per source and a scan button, and shows the rejection log.
   - The importer now imports every host (unknown ones as `auto`, which the sidecar auto-detects).
9. **Runbook.** README §5 "Operate": update (pull and up), logs, backup and restore, rotate the bridge token, reconnect Google weekly (Testing mode).

## Non-Goals

- Tailoring and the use of `/data` content (separate issue).
- Applying `portals.yml` title, location and experience filters to the scanner. If the scanner can't use them, this becomes a follow-up issue.
- Public internet exposure or Tailscale Funnel.
- Image signature verification at deploy (cosign isn't installed). Noted as a follow-up.
- Moving off Docker Desktop to colima or Kiri.

## Open Questions (Yaaf)

- **Q1 — Google OAuth client.**
  - You add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (GCP project `Career-Ops`) to `.env` yourself. The agent doesn't handle secrets.
  - You add the redirect URI above in GCP → Credentials → OAuth client → Authorized redirect URIs.
- **Q2 — Archive the old career-ops repo** on GitHub once everything is verified? *Recommendation: yes. It's reversible (unarchive).*
- **Q3 — Linear ops.** Set `LINEAR_API_KEY` and `LINEAR_TEAM_ID` now? Leave empty to keep it off.

## Acceptance Criteria

- [ ] **AC1** The `career-os` compose project is healthy from GHCR images. After `docker compose restart` and a Docker Desktop restart, both containers come back healthy without manual steps.
- [ ] **AC2** From a tailnet browser, `https://your-mac-mini.your-tailnet.ts.net:8080` loads in live mode (not demo). `curl` with a wrong `Tailscale-User-Login` header gets 403. The other `/` service still works.
- [ ] **AC3** The importer creates sources for all `portals.yml` tracked companies and ingests the pending pipeline URLs. A second run creates no duplicates. Counts are reported.
- [ ] **AC4** A manual ATS scan runs. Jobs arrive and hydrogen scoring scores at least one batch through the bridge.
- [ ] **AC5** JOB-6 AC11: Google connected with `gmail.compose`, Sync now succeeded, at least one thread linked (or a manual link works), a draft appears in Gmail Drafts unsent, and a reminder appears in Calendar. Test items are deleted afterwards after asking Yaaf.
- [ ] **AC6** The nightly backup job is loaded. One manual run produces a `.backup` file that passes `PRAGMA integrity_check`. A restore into a throwaway volume boots the app with the same job count.
- [ ] **AC7** the old career-ops repo is archived (if Q2 = yes).
- [ ] **AC9** Filtered scan: integration test against a fake sidecar (accepted, rejected and error paths; refuses without `SCANNER_URL`). A live run on a copy of the database ingests only filter-accepted postings.
- [ ] **AC8** README runbook. Checks for the surfaces touched pass: scanner/script tests, `bash -n`, `plutil -lint`, PII grep.

## Docs Impact

`README.md` (runbook), `docs/architecture.md` (deployment and backups), `docs/trust.md` (tailnet user, backups contain OAuth tokens, which are encrypted), `project/STATE.md`; JOB-6 verify-archive.
