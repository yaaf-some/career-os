# JOB-7 Plan — Mac mini cutover

One branch, `feat/job-7-cutover`, carries the repo changes (scripts, plist example, docs). The host operations aren't in git; this file records them under Execution Notes, with no secrets.
**Execution:** the lead session works directly (no subagents). Run `source ~/.zshrc` in fresh shells. Never print `.env` values.

## Host
- [x] **1.1 `.env`** — set `ALLOWED_TAILSCALE_USER` (from `tailscale status --json`, not printed), `DATA_DIR=$HOME/career-data`, `GOOGLE_REDIRECT_URI` (tailnet URL). Yaaf adds the Google client ID and secret (Q1).
- [x] **1.2 Data** — `gh repo clone your-github-handle/your-career-data ~/career-data`.
- [x] **1.3 Stack** — `docker compose -p career-os pull && docker compose -p career-os up -d`. Verify: both containers healthy; `/healthz` ok.
- [x] **1.4 Access** — confirm the existing `tailscale serve` mapping for `:8080`; tailnet page loads live; a wrong user gets 403; the `/` mapping for another service is untouched (AC2).
- [x] **1.5 Restart drill** — `docker compose restart`, then quit and reopen Docker Desktop; both containers come back healthy (AC1).

## Repo (`feat/job-7-cutover`)
- [x] **2.1 Importer** — `scripts/import-career-ops.mjs` (Node 26, no deps; a tiny YAML subset parser for `tracked_companies`). Takes the data dir and API base as arguments; idempotent (skips existing sources by careers URL; ingest is deduped by canonical URL). Tests: `scripts/import-career-ops.test.mjs` on synthetic fixtures (`node --test`).
- [x] **2.2 Backup** — `scripts/backup-db.sh`: a throwaway `alpine` container with the `career_os_db` volume mounted read-only runs `sqlite3 .backup` to `~/Backups/career-os/career-os-YYYYMMDD.db`, then `PRAGMA integrity_check`, and prunes files older than 14 days. `deploy/launchd/com.career-os.backup.plist.example` runs it daily at 03:30. CI: `plutil -lint` (existing job glob) and `bash -n`.
- [x] **2.3 Restore doc + drill** — README: restore into a throwaway volume, boot a throwaway project, compare job counts (AC6).
- [x] **2.4 Runbook + docs** — README §5 "Operate", architecture (deployment and backups), trust (tailnet user; backups hold encrypted tokens), STATE.

## Filtered scanning (PR B, `feat/job-7-filtered-scans`)
- [x] **4.1** API: `SCANNER_URL` config; `scan_via_sidecar`; `run_ats_scan` → sidecar (ingest accepted, `filtered_audit` for rejected, `last_error` per source; 503 without the sidecar); `GET /api/sources` adds `matched_count` and `filtered_audit`. Tests against a fake sidecar.
- [x] **4.2** Web: Sources page live (mappers, per-source scan switch, scan result and error, rejection log); importer imports all hosts.
- [ ] **4.3** Live: enable sources and scan after merge and release.

## Live
- [x] **3.1 Import** — run the importer against the live API (AC3).
- [ ] **3.2 Scan + score** — trigger a scan from Sources; confirm jobs arrive and hydrogen scoring runs (AC4).
- [ ] **3.3 Google (JOB-6 AC11)** — once Yaaf has added the client and signed in: Sync now, linking, draft, reminder (AC5). Ask before deleting the test draft and event.
- [ ] **3.4 Retire** — archive the old career-ops repo (Q2) (AC7).
- [ ] **3.5 Close** — PR, CI, merge with OK; JOB-6 and JOB-7 verify-archive.

## Execution Notes

- **1.1** `.env`: added `ALLOWED_TAILSCALE_USER` (your login, taken from `tailscale status --json`), `DATA_DIR=~/career-data` and `GOOGLE_REDIRECT_URI`; `chmod 600`. The Google client ID and secret are still missing (Q1, Yaaf).
- **1.3** Compose project `career-os` runs the GHCR `latest` images built from `e77652c` (JOB-6 PR C). Both containers healthy.
- **1.4** `tailscale serve` already mapped `:8080` → `127.0.0.1:8080`; `/` serves another local service and was left untouched. Auth: no header 401, wrong user 403, correct user 200, through the tailnet 200. The in-app browser pane blocks tailnet subresources (`ERR_BLOCKED_BY_CLIENT`), so the page was checked with `curl` (JS, CSS and manifest all 200), not visually.
- **1.5** `docker compose restart` came back healthy. `docker kill` counts as a manual stop, so Docker doesn't restart that container (expected). Docker Desktop has `AutoStart: true`; a full Docker Desktop restart was **not** run, to avoid disrupting other local Docker use.
- **Found:** the web called `/api/healthz`, but the API route is `/healthz` (the SPA returned HTML). Fixed in `client.ts` with a test.
- **2.1** The importer lives at `scanner/tools/import-career-ops.mjs`, so the scanner CI job runs its tests (`scanner/tests/import-career-ops.test.mjs`).
- **2.2** Backup: `career-os-api --backup-stdout` (`VACUUM INTO` to tmpfs, streamed to stdout). Distroless has no shell, and `docker cp` can't read tmpfs. The host script checks the file with macOS `/usr/bin/sqlite3`. Docker Desktop's CLI is in `~/.docker/bin`, so it's on the plist PATH.
- **3.1** Live import: 56 sources created (all **disabled**) and 36 pipeline jobs ingested. One company on Paylocity isn't supported by the API scanner. A re-run created nothing (56 skipped, 36 duplicates).
- **3.2 (partial)** One live hydrogen batch: claude/haiku scored 10 of the imported jobs in 9 s, keeping 7 and skipping 3. **ATS scan not run.** The API fetches every board posting directly (`integrations/scanner.rs`) with no title, location or experience filter; the scanner sidecar's filters, which read the old `portals.yml` rules, are never called. Enabling 56 sources would ingest thousands of irrelevant postings and spend AI scoring calls on them. Sources stay disabled until scans go through the filtered sidecar (proposed follow-up).
- **2.3** Restore drill: tonight's backup was restored into a throwaway volume, and a throwaway app on it served 36 jobs and 56 sources, the same as live. The README restore step needed `chown 65532:65532` (the app runs as nonroot); fixed. The backup LaunchAgent is installed and kickstarted (exit 0, 03:30 daily).
- **4.x** Scan on a **copy** of the live DB (branch build, separate port): 56 sources, 10,642 postings fetched, **10,477 filtered**, 153 ingested, in 59 s. 5 boards returned 404, so their slugs in the old data are stale (see `last_error`). The title filter is coarse: aerospace roles like "Fuel/Radar Systems Engineer" pass "Systems Engineer". Hydrogen scoring ranks those low; filter tuning is a follow-up.
- `ls` is aliased in the user's shell; use `/bin/ls` in scripts.
