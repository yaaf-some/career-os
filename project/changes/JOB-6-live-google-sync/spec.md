# JOB-6 — Live Google sync: Today, Tracker, Gmail drafts, Calendar reminders, Linear ops

**Status:** Approved 2026-11-27 (Q1 yes, Q2 yes, Google sync twice daily)
**Issue:** JOB-6 (Linear, no description) · Parent JOB-1 · Branches `feat/job-6a-read` → `feat/job-6b-write` → `feat/job-6c-linear`

## Problem / Context

The Google plumbing exists but nothing reaches the user:

- **Sync exists, isn't connected to jobs.** `state.rs::sync_google_workspace` (runs hourly today, `scheduler.rs`) upserts 20 inbox threads (`label:inbox (interview OR application OR recruiter)`) into `gmail_threads` and upcoming events into `calendar_events`. Both tables have `application_id`, but nothing ever sets it, so mail and events aren't linked to any job.
- **The web calls six routes the API doesn't have**, and silently shows demo data instead:
  - `GET /api/today`
  - `GET /api/tracker` and `PATCH /api/tracker` (the API has `/api/applications` with a different shape)
  - `POST /api/jobs` (quick-add)
  - `POST /api/jobs/{id}/email-draft`
  - `POST /api/jobs/{id}/calendar-reminder`
  - `POST /api/jobs/{id}/tailor`
- **Job detail drops comms data.** `GET /api/jobs/{id}` leaves out threads and events, so the drawer's Gmail & Calendar tab is always empty in live mode, as are `gmailStatus` and `gmailDraft`.
- **Missing OAuth scope.** The scopes are `gmail.readonly`, `drive.file`, `calendar.events` and `userinfo.email`. A Gmail draft can't be created without `gmail.compose`.
- **Linear client unused.** `integrations/linear.rs` (`create_issue`) exists and `LINEAR_API_KEY` / `LINEAR_TEAM_ID` are read, but nothing calls them.
- **Hidden failures.** Outside the AI routes, the web demo fallback turns 404s and 5xx errors into fake data in live mode.

## Goals

1. **Today page from real data:**
   - Replies waiting on you: threads that need a reply and are linked to an application.
   - Agenda: calendar events in the next 7 days.
   - Follow-ups due: applications whose `next_followup_at` is today or earlier.
   - Top matches: the five best-scored pending or shortlisted jobs.
2. **Tracker from real data:** one row per application, with job, stage, latest thread, follow-up date and notes. Editing stage, follow-up or notes saves through the API.
3. **Mail and events linked to jobs.** Each sync links threads and events to applications using deterministic rules (no AI). A manual link route handles misses.
4. **Draft-only Gmail.** Saving a draft in the drawer creates or updates a real Gmail draft. The app **never sends** mail; you review and send it in Gmail.
5. **Calendar reminders.** Creating a follow-up or prep reminder in the drawer adds a Google Calendar event, saves it in `calendar_events` linked to the application, and sets `next_followup_at` when the reminder is a follow-up.
6. **Quick-add.** `POST /api/jobs` with `{url, title?, company?}` adds a manual job with status `pending_scoring`, so the scheduler scores it.
7. **No fake data in live mode.** Once these routes exist, the web shows API errors instead of demo data, except under `VITE_DEMO_MODE`.
8. **Sync status visible.** `POST /api/sync/google` runs a sync on demand. Settings shows the last `sync_runs` result for each type and the date Google consent expires (Testing mode, 7 days).

## Non-Goals

- **`/tailor` (Drive resume and cover-letter generation).** This needs grounded AI generation from `DATA_DIR` (zero fabrication). It gets its own issue, and the web keeps the button disabled with "not available yet" in live mode.
- **Sending email, or any automatic outbound message.**
- **Gmail push or watch, and incremental sync with `historyId`.** Polling twice a day is enough for one user; `sync_cursors` stays unused.
- **AI classification of emails.** Linking is deterministic only.
- **Linear sync in both directions** (PR C is one-way only).

## Decisions (Yaaf, 2026-11-27)

- **Q1 — Gmail scope: yes.** Add `gmail.compose`, which requires one re-consent. The code only calls `drafts.create` and `drafts.update`; a test asserts no `/send` request is ever made.
- **Q2 — Linear ops: yes.** PR C: moving an application to `applied` creates one Linear issue. Nothing happens without `LINEAR_API_KEY`.
- **Sync cadence: twice daily for now.** Google sync runs every 12 h (`GOOGLE_SYNC_INTERVAL_HOURS`, default 12), split out of the hourly loop. Hydrogen scoring stays hourly. "Sync now" covers anything in between.

## Design

### Linking (`crates/api/src/state.rs`, new `src/sync/link.rs`)
- **Thread → application.** Link a thread when either rule matches:
  - the sender's domain (`from_email`) equals the job URL's registrable domain or a known ATS sender (`greenhouse.io`, `lever.co`, `ashbyhq.com`), **and** the normalized company name appears in the subject or snippet;
  - or the normalized company name appears in the subject.
  
  When several applications match, take the most recently updated one. Never overwrite a link set by hand (new column `link_source`: `auto` or `manual`).
- **Event → application.** Link when the normalized company name appears in the event title. Events the app created are linked when they're made.
- **Manual link.** `PUT /api/gmail-threads/{id}/application` with `{applicationId|null}` sets `link_source='manual'`.
- **Untrusted text.** Email and event text is matched as plain strings, never sent to an AI model and never interpreted (`docs/trust.md` §3).

### API routes (camelCase JSON, typed, in OpenAPI)
- **`GET /api/today`** returns `TodayResponse`, matching `web/src/api/types.ts`:
  - `dateLabel`
  - `unreadReplies`: threads with `needs_reply=1` that are linked
  - `agenda`: events with `starts_at` in the next 7 days
  - `followUpsDue`: applications with `next_followup_at <= end of today`, flagged `overdue` when it's before now
  - `topMatches`: the top 5 jobs by `tier1_score` with status `pending_triage` or `shortlisted`
- **`GET /api/tracker`** returns `TrackerResponse`. Stages are mapped the same way as `web/src/api/jobs.ts`. **`PATCH /api/tracker`** with `{jobId, stage?, nextFollowUpAt?, notes?}` updates the application (creating it at `shortlisted` if it doesn't exist) and returns the list.
- **`GET /api/jobs/{id}`** adds `gmail_threads` and `calendar_events` for the application. Web `jobDetailFromApi` maps these to `gmailStatus` (`reply_received` when a linked thread needs a reply, `awaiting_reply` when threads exist, else `none`), `calendarReminders`, and `gmailDraft` (from a new `email_drafts` row).
- **`POST /api/jobs`** with `{url, title?, company?}`. Title and company default to values derived from the URL host and path. Uses the same canonical-key de-duplication as ingest and returns `JobSummary`-compatible JSON.
- **`POST /api/jobs/{id}/email-draft`** with `{to, subject, body, confirmed}` upserts `email_drafts`. When `confirmed` is true and Google is connected, it calls Gmail `drafts.create`, or `drafts.update` if a `gmail_draft_id` exists, and returns the job detail. It never calls `messages.send` or `drafts.send`.
- **`POST /api/jobs/{id}/calendar-reminder`** with `{title, startsAt, notes, kind?='followup'}` calls `CalendarClient::create_event` (30 minutes), inserts into `calendar_events` with the application id, and sets `applications.next_followup_at` when `kind` is `followup`.
- **`POST /api/sync/google`** runs `sync_google_workspace` now and returns the `sync_runs` row. A mutex prevents overlapping with the scheduled run.
- **Errors:**
  - Google not connected: 409 `GOOGLE_NOT_CONNECTED`.
  - Token expired: 401 is mapped to 409 `GOOGLE_RECONNECT_REQUIRED`, never passed through as user auth.
  - Upstream 5xx: 502.

### Migration `0004_google_sync.sql`
- `gmail_threads.link_source TEXT NOT NULL DEFAULT 'auto'`.
- `email_drafts` table: `id`, `application_id` (unique, foreign key), `to_email`, `subject`, `body`, `confirmed`, `gmail_draft_id`, `updated_at`.
- `calendar_events.notes TEXT`.

### OAuth
- Add `gmail.compose` to `DEFAULT_GOOGLE_SCOPES`.
- `/api/auth/google/status` gains `missingScopes`, computed from the granted scopes already saved in `oauth_tokens.scope`.
- Settings shows "Reconnect to grant draft access" when scopes are missing.

### Web
- `client.ts` gets mappers for today, tracker, tracker patch, quick-add, email-draft and calendar-reminder.
- `requestWithFallback` stops falling back on 404 and 5xx for these routes (`fallbackOnServerError: false`, and 404 is no longer a fallback trigger outside demo mode).
- The drawer's comms tab shows the linked threads (subject, snippet, open-in-Gmail link) and labels the draft action "Save to Gmail Drafts (you send it)".
- In live mode the tailor button is disabled with "not available yet".
- Settings gets a "Sync now" button, the last sync result for each type, and the consent-expiry date.

### Docs
- `architecture.md`: the sync and linking flow.
- `trust.md`: drafts only, never send; email text is untrusted and matched as plain strings only; scopes listed.
- `glossary.md`: linking, `link_source`.
- STATE.

## Acceptance Criteria

- [ ] **AC1** Linking: unit tests cover domain + company matches, subject matches, no match, picking the most recent of several applications, and a manual link surviving re-sync.
- [ ] **AC2** `GET /api/today` and `GET /api/tracker`: integration tests on seeded data. A shared fixture (`web/src/__tests__/fixtures/today.json`, `tracker.json`) is written by Rust tests and read by web tests.
- [ ] **AC3** `PATCH /api/tracker` updates stage, follow-up and notes, and creates the application when it's missing (integration test).
- [ ] **AC4** `POST /api/jobs` adds a `pending_scoring` manual job; a duplicate URL returns the existing job (integration test).
- [ ] **AC5** An email draft with `confirmed=true` calls Gmail `drafts.create`, then `drafts.update` on re-save. A wiremock test asserts no request to any `/send` path. When Google isn't connected, the draft is saved locally and the response is 409.
- [ ] **AC6** A calendar reminder creates a Calendar event (wiremock), stores the linked row, and sets `next_followup_at` for `followup`.
- [ ] **AC7** `POST /api/sync/google` records a `sync_runs` row. A concurrent call doesn't run a second sync (test). The scheduler runs Google sync every `GOOGLE_SYNC_INTERVAL_HOURS` (default 12) and hydrogen scoring hourly (config test).
- [ ] **AC8** Web live mode shows the API error state, not demo data, for today, tracker, quick-add, draft and reminder failures (vitest with mocked fetch).
- [ ] **AC9** Web mappers are tested against the shared fixtures. The drawer shows linked threads and reminders from the API.
- [ ] **AC10** Moving an application to `applied` with `LINEAR_API_KEY` set creates exactly one Linear issue and stores its id. Without the key, nothing happens (wiremock).
- [ ] **AC11** Live check on the M2:
  1. Connect Google, reconsenting with the new scope.
  2. Run "Sync now" and confirm a real recruiter thread is linked to a seeded job.
  3. Save a draft and confirm it appears in Gmail Drafts unsent.
  4. Create a reminder and confirm it appears in Calendar.
  5. Confirm Today and Tracker show these.
  6. Clean up the test draft and event afterwards, after confirming with Yaaf.
- [ ] **AC12** Full checks: Rust fmt, clippy and test; web typecheck, test and build; PII grep. Docs updated.

## Docs Impact

`docs/architecture.md`, `docs/trust.md` (§3 email handling and §2 scopes), `docs/glossary.md`, `README.md` (scopes and re-consent), `project/STATE.md`. ADR: none unless Q1 changes the trust model materially. If it does, add ADR-003 "Gmail drafts, never send".
