# JOB-11 — Hardening Follow-ups

**Status:** In Progress · **Surfaces:** `crates/api`, `web/` · **Linear:** `JOB-11` (to create)

## Problem / Context

After JOB-9/JOB-10 shipped, four rough edges remain where the live app shows
something untrue or unhelpful:

1. **Demo data masks live errors.** In `web/src/api/client.ts`, `getSettings`,
   `updateSettings` (ai_routing), `triageJob`, `tailorJob`, `getGoogleAuthStatus`,
   `startGoogleAuth`, `getJobCommute`, and `previewCommute` still use the default
   `fallbackOnServerError: true`, so a live 404/5xx silently renders demo data
   (e.g. a fake commute, "connected" Google status, fake settings).
2. **Commute prefs never persist.** The API already reads `home_location_area` /
   `travel_mode` from `settings` (`routes/commute.rs::load_commute_prefs`), but the
   web `updateSettings` writes commute prefs to the demo store only and
   `settingsFromApi` ignores them.
3. **Linear Settings card is always "Offline / no issues".** `settingsFromApi`
   hardcodes `linearConnected: false`, `linearIssues: []`; no endpoint exposes
   whether Linear is configured or which applications have issues
   (`applications.linear_issue_id` stores identifiers like `JOB-42`).
4. **OAuth callback returns raw JSON.** `GET /api/auth/google/callback` ends the
   browser flow on a JSON blob instead of returning the user to the app.
5. **`needs_reply` flags automated mail.** `gmail.rs::normalize_thread` sets
   `needs_reply = INBOX && !SENT`, so ATS confirmations/no-reply notifications
   crowd Today's "Replies" list.

## Goals

- Outside `VITE_DEMO_MODE`, every route the API implements surfaces real errors
  (no demo fallback on 404/5xx). Network failure (`TypeError`) still falls back.
- Commute prefs round-trip through `PUT /api/settings/{home_location_area,travel_mode}`
  with server-side validation.
- `GET /api/integrations/linear` → `{configured, team_key, issues[]}`; Settings
  shows real state.
- OAuth callback redirects to `/settings?google=connected` (or
  `?google=error&reason=<code>`); Settings shows a one-shot banner.
- `needs_reply` excludes automated senders and Gmail auto-categories.

## Non-Goals

- `/api/jobs/{id}/tailor` (next change, JOB-12). `tailorJob` keeps its demo
  fallback until then since the route doesn't exist yet.
- Ashby non-API fallback: the scanner already has an opt-in `ashby: { embed: true }`
  plus an automatic fallback for oversized bodies. It won't fall back on 404
  either, since 22% of boards always return 404 and that would double traffic.
  career-os sources can't set the opt-in yet: that's a separate follow-up.
- Live Linear GraphQL reads (state/priority) — show stored identifiers only.
- Re-classifying already-synced threads beyond the next sync.

## Design / Approach

**1. Demo fallback.** Pass `LIVE_ONLY` to the eight calls above (except
`tailorJob`). Settings/commute UI already renders query errors via
`AlertBanner`; confirm each view shows an error state rather than crashing.

**2. Commute prefs.** `validate_setting` gains `home_location_area` (non-empty
string ≤ 120 chars) and `travel_mode` (`"drive" | "transit"`). Web
`updateSettings` PUTs whichever fields are present (ai_routing, home area,
travel mode) then re-reads; `settingsFromApi` parses both keys.

**3. Linear status.** New `routes/integrations.rs::linear_status`:
`configured = state.linear.is_some() && config.linear_team_id.is_some()`;
`issues` = up to 20 `applications` rows with `linear_issue_id` not null and ≠
`'creating'`, joined to `jobs` for `company`/`title`, newest first;
`team_key` = prefix of the first identifier (before `-`) or `null`. Never
returns the API key or team UUID. Web `LinearJobIssue` becomes
`{key, title, company, url: null}`, dropping fake state/priority.

**4. OAuth callback.** Handler returns `Redirect::to("/settings?google=connected")`
on success; on `BadRequest`/`Config`/upstream errors, redirects with
`?google=error&reason=<invalid_state|not_configured|exchange_failed>` (fixed
reason codes, never raw error text in the URL). Settings reads the param once,
shows `AlertBanner`, invalidates auth status, and strips the param via
`history.replaceState`.

**5. needs_reply.** `needs_reply = INBOX && !SENT && !automated`, where
automated = From local-part matches `no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster`
(case-insensitive) or labels include `CATEGORY_PROMOTIONS`/`CATEGORY_SOCIAL`/
`CATEGORY_FORUMS`. `CATEGORY_UPDATES` stays eligible (recruiter replies land there).

## Acceptance Criteria

- [ ] With the API returning 500 on `/api/settings`, `/api/jobs/{id}/commute`,
      `/api/commute/preview`, `/api/auth/google/status`, the web shows an error,
      not demo data (vitest per call).
- [ ] `PUT /api/settings/travel_mode` with `"bike"` → 400; `"transit"` → 200 and
      `GET /api/jobs/{id}/commute` uses it (cargo test).
- [ ] Saving home area in Settings persists across reload (vitest on client
      mapping + cargo test on validation).
- [ ] `GET /api/integrations/linear` returns `configured:false, issues:[]` when
      unconfigured and lists stored identifiers when present; response contains
      no key/UUID (cargo test). Listed in OpenAPI.
- [ ] Callback success → 303 to `/settings?google=connected`; bad state → 303 to
      `/settings?google=error&reason=invalid_state` (cargo test).
- [ ] `normalize_thread` marks `no-reply@` and `CATEGORY_PROMOTIONS` threads
      `needs_reply=false`; a human `CATEGORY_UPDATES` thread stays `true` (cargo test).
- [ ] Full checks green: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
      `cargo test`, `npm run typecheck && npm test && npm run build` in `web/`.

## Docs Impact

- `docs/architecture.md`: new `/api/integrations/linear`; callback redirect;
  demo-mode rule ("demo data only in `VITE_DEMO_MODE` or on network failure").
- `project/STATE.md` at archive.
