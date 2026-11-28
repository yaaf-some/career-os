# JOB-11 Plan — Hardening Follow-ups

Single PR (`feat/job-11-hardening`), ~5 small commits. Verify after each task.

## Tasks

### 1. needs_reply filter (API)
- [x] `crates/api/src/integrations/gmail.rs`: add `is_automated(from, labels)`;
      use it in `normalize_thread`.
- [x] Tests: `no-reply@`, `notifications@`, `CATEGORY_PROMOTIONS` → false;
      human sender + `CATEGORY_UPDATES` → true.
- Verify: `cargo test -p career-os-api gmail`

### 2. Commute pref validation (API)
- [x] `crates/api/src/routes/settings.rs::validate_setting`: `home_location_area`
      (non-empty string ≤ 120), `travel_mode` (`drive|transit`).
- [x] Tests: bad/good values; commute route picks up saved `travel_mode`.
- Verify: `cargo test -p career-os-api settings commute`

### 3. Linear status endpoint (API)
- [x] New `crates/api/src/routes/integrations.rs` (`linear_status`), register in
      `routes/mod.rs`, `lib.rs` (`GET /api/integrations/linear`), `openapi.rs`.
- [x] Tests: unconfigured → `configured:false`; rows with `JOB-42` and
      `creating` → only `JOB-42`, `team_key:"JOB"`; body has no secret fields.
- Verify: `cargo test -p career-os-api integrations`

### 4. OAuth callback redirect (API)
- [x] `crates/api/src/routes/auth.rs::google_auth_callback` → `Redirect::to`
      (303) with fixed reason codes; update utoipa responses.
- [x] Tests: success (mock token server, existing pattern) and invalid state.
- Verify: `cargo test -p career-os-api auth`, then full
      `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`

### 5. Web client hardening
- [ ] `web/src/api/client.ts`: `LIVE_ONLY` on `getSettings`, `updateSettings`,
      `triageJob`, `getGoogleAuthStatus`, `startGoogleAuth`, `getJobCommute`,
      `previewCommute`.
- [ ] `updateSettings`: PUT `home_location_area` / `travel_mode` when present;
      `settingsFromApi` parses them.
- [ ] Add `careerApi.getLinearStatus()` + query in `queries.ts`; update
      `LinearJobIssue` in `types.ts` and `demoData.ts`.
- [ ] Tests in `web/src/__tests__/` (500 → error, settings round-trip mapping,
      linear mapping).
- Verify: `cd web && npm run typecheck && npm test`

### 6. Settings UI
- [ ] `web/src/routes/SettingsView.tsx`: Linear card from `getLinearStatus`
      (configured/team key/issue list, no fake state); `?google=` banner +
      `history.replaceState`; error states for settings/commute queries.
- [ ] Test in `trackerSourcesSettings.test.tsx` / `commuteAndAuth.test.tsx`.
- Verify: `cd web && npm run typecheck && npm test && npm run build`

### 7. Docs
- [ ] `docs/architecture.md` (endpoint, redirect, demo-mode rule), `README.md`
      (Ashby embed note).
- [ ] PII scan incl. untracked files; open PR; keep `CI Gate` green.

Then `project-verify-archive` (deploy to M2, curl live endpoints).

## Execution Notes / Deviations

- Task 4: callback success is covered by a unit test of the redirect mapping
  (`callback_redirect(Ok)`), not end-to-end: the token endpoint isn't
  overridable through `AppState`. Invalid/missing state, Google `error=` (new
  `denied` reason), and not-configured paths are tested through the handler.
  `code`/`state` are now optional so a Google `?error=access_denied` redirect
  lands on Settings instead of a 400 extractor error. `GoogleAuthCallbackResponse`
  removed (no JSON body anymore).
- A localhost `GOOGLE_REDIRECT_URI` redirects to localhost `/settings`, which
  still needs the Tailscale header like any other page — same as before.
