# JOB-6 Plan — Live Google sync

Branch per PR off `main`. Merge `origin/main` into a branch to catch up; never rebase pushed history. Each PR must be green on `CI Gate` before the next starts, and each merges only after Yaaf's OK.
**Execution:** the lead session implements every task directly, with no subagent delegation. Run each task's Verify line before checking its box. Run `source ~/.zshrc` in fresh shells to get cargo on PATH.

## PR A — Read side: linking, Today, Tracker, quick-add, sync now (`feat/job-6a-read`)

- [x] **1.1 Migration 0004** — `crates/api/migrations/0004_google_sync.sql`:
  - `gmail_threads.link_source`
  - `email_drafts` table
  - `calendar_events.notes`

  Verify: `cargo test -p career-os-api` (migrations run in tests).
- [x] **1.2 Linking** — `src/sync/link.rs`:
  - Pure functions: normalize company, registrable domain, `match_thread`, `match_event`.
  - Call them from `sync_google_workspace` after each upsert; never touch `link_source='manual'` rows.
  - Add `PUT /api/gmail-threads/{id}/application`.
  - Unit tests for AC1.
  - Scheduler: Google sync moves to its own loop every `GOOGLE_SYNC_INTERVAL_HOURS` (config, default 12, clamp 1–168); the hourly loop keeps only hydrogen scoring. Add it to `.env.example`, compose and the README.

  Verify: `cargo test -p career-os-api link config`
- [x] **1.3 `GET /api/today`** — `src/routes/today.rs`: camelCase types matching the web, OpenAPI entry, integration test on seeded data, plus the `today.json` fixture test writing `web/src/__tests__/fixtures/today.json` (AC2).

  Verify: `cargo test -p career-os-api today`
- [x] **1.4 `GET` and `PATCH /api/tracker`** — `src/routes/tracker.rs`: maps stages both ways (the web's `saved/screen/interview/archived` and the DB's `shortlisted/recruiter/interviewing/closed`), creates the application when it's missing, and writes the `tracker.json` fixture (AC2, AC3).

  Verify: `cargo test -p career-os-api tracker`
- [x] **1.5 `POST /api/jobs` quick-add** — `src/routes/jobs.rs`: reuses the ingest canonical-key logic and derives title/company from the URL when they're absent (AC4).

  Verify: `cargo test -p career-os-api quick_add`
- [x] **1.6 Job detail comms + `POST /api/sync/google`**:
  - `JobDetailResponse` gains `gmail_threads`, `calendar_events` and `email_draft`, and the `jobs.json` fixture is regenerated.
  - Sync route with a `tokio::sync::Mutex` guard shared with the scheduler, and Google error mapping (409 codes).
  - Tests for AC7.

  Verify: `cargo test -p career-os-api`
- [x] **1.7 Web read side**:
  - Mappers for today, tracker and comms in `jobs.ts`; live mode drops the demo fallback on 404/5xx for these routes.
  - TodayView, TrackerView and the drawer comms tab show linked threads.
  - Settings: "Sync now", last runs (`/api/sync-runs`), consent expiry.
  - The tailor button is disabled in live mode.
  - Vitest against the fixtures (AC8, AC9).

  Verify: `npm run typecheck && npm test && npm run build` in `web/`
- [ ] **1.8 Docs + PR A** — `architecture.md`, `trust.md` §3, `glossary.md`, STATE; full checks; PII grep; open the PR; CI green; ask Yaaf to merge.

## PR B — Write side: Gmail drafts + Calendar reminders (`feat/job-6b-write`)

- [x] **2.1 Scope** — add `gmail.compose` to `DEFAULT_GOOGLE_SCOPES`; `/api/auth/google/status` reports `missingScopes`; Settings shows a reconnect prompt; README notes the re-consent.

  Verify: `cargo test -p career-os-api auth`
- [x] **2.2 Gmail drafts client** — `integrations/gmail.rs`: `create_draft` and `update_draft` (RFC 2822, base64url `raw`). No send method exists. The wiremock test asserts there is no `/send` request.

  Verify: `cargo test -p career-os-api gmail`
- [x] **2.3 `POST /api/jobs/{id}/email-draft`** — upserts `email_drafts`; with `confirmed` it creates or updates the Gmail draft; returns 409 when Google isn't connected (AC5).

  Verify: `cargo test -p career-os-api email_draft`
- [x] **2.4 `POST /api/jobs/{id}/calendar-reminder`** — creates the event, stores the linked row, sets the follow-up date (AC6).

  Verify: `cargo test -p career-os-api calendar_reminder`
- [x] **2.5 Web write side** — map the draft and reminder responses; button text "Save to Gmail Drafts (you send it)"; show 409 errors with a reconnect hint.

  Verify: web checks.
- [ ] **2.6 Docs + PR B** — `trust.md` (drafts only, never send; scopes), README, ADR-003 if needed, STATE; full checks; PR; CI; ask Yaaf.

## PR C — Linear ops (`feat/job-6c-linear`)

- [ ] **3.1** On a tracker stage change to `applied`, with `LINEAR_API_KEY` and `LINEAR_TEAM_ID` set and `linear_issue_id` empty, call `create_issue` (title "Applied: {title} @ {company}", job URL in the description) and store the id. Do nothing without the key (AC10).

  Verify: `cargo test -p career-os-api linear`
- [ ] **3.2** Docs + PR C.

## Verify & Archive

- [ ] **4.1 AC11 live check on the M2** — with Yaaf, who signs in to Google: run sync, link, draft, reminder, Today, Tracker. Ask before deleting the test draft and event.
- [ ] **4.2** `project-verify-archive`: tick the ACs, sync docs, archive the folder, update STATE.

## Execution Notes

- 1.2: linking also matches the company's own sender domain (`r@examplecorp.com` for "Example Corp"), since job URLs often point at an ATS rather than the company's domain.
- 1.4: the API keeps the DB stage names; translation to and from the web's names lives in `web/src/api/jobs.ts` (`stageFromApi`, `trackerPatchToApi`), the same as job list/detail.
- 1.3: `GET /api/today` returns `date` (UTC `YYYY-MM-DD`) and the web formats `dateLabel`. `topMatches` uses the API job shape and the web maps it with `jobSummaryFromApi`.
- 1.7: until PR B, the email-draft and calendar-reminder buttons still fall back to demo behavior in live mode, because those routes don't exist yet (fixed in 2.5).
- 2.4: `startsAt` with an offset is normalized to UTC before storing; a test caught that it was stored as `-08:00`.
- 2.6: ADR-003 added, because `gmail.compose` can technically send, so the never-send rule is enforced by code and tests rather than by the scope.
- Live check (throwaway compose stack, 2026-11-27):
  - Scheduler logged `google_sync_hours=12`.
  - Quick-add from the UI showed "Added … (hydrogen unscored)".
  - `PATCH /api/tracker` set a follow-up, and Today showed it as overdue.
  - Changing the stage in the Tracker UI to Interview saved `interviewing` and left the follow-up and notes unchanged.
  - Sync now without Google returned 409 `GOOGLE_NOT_CONNECTED`.
