# JOB-12 Plan — Tailored Resume & Cover Letter Google Docs

Single PR (`feat/job-12-tailor-google-docs`), ~7 small commits. Verify after each task.

## Tasks

### 1. Tailoring dossier builder (API)
- [x] `crates/api/src/profile/mod.rs`: add `build_tailoring_dossier` (strictly grounded in `identity.md`, `experience.md`, `skills.yml` `strong_production`/`working_hands_on`, non-`tbd` `projects/*.md`, and synced `project_docs`; excludes `psych-and-vibe.md` and `not_my_lane`; strips `tbd` sections).
- [x] Unit tests: missing profile -> `None`; `tbd` stripped, `psych-and-vibe.md` & `not_my_lane` excluded, synced `project_docs` & `[WIP]` tags preserved.
- Verify: `cargo test -p career-os-api profile`

### 2. AI tailor prompt, parser & mock support (API)
- [x] `crates/api/src/ai/mod.rs`: add `TailorEvidenceBullet`, `TailorAiOutput`, `build_tailor_prompt` (wrapping untrusted `jd_text` in `<untrusted_job_description>`), `parse_tailor_response`, and `MockAiProvider` tailor output.
- [x] Unit tests: valid JSON + fenced JSON parsing; rejects empty resume/cover letter or bullets missing `source_file`/`text`.
- Verify: `cargo test -p career-os-api tailor`

### 3. Drive HTML -> Google Doc upload & config (API)
- [x] `crates/api/src/integrations/drive.rs`: add `markdown_to_doc_html` (HTML-escaped headings, lists, bold/italic, rules, paragraphs) and `DriveClient::create_google_doc_from_html`.
- [x] `crates/api/src/config.rs`, `.env.example`, `docker-compose.yml`: add optional `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`.
- [x] Unit tests: XSS/HTML escaping, Markdown rendering, multipart upload to `application/vnd.google-apps.document`.
- Verify: `cargo test -p career-os-api drive`

### 4. Migration, route, OpenAPI & job detail hydration (API)
- [x] `crates/api/migrations/0007_tailor_runs.sql`: create `tailor_runs` table.
- [x] `crates/api/src/error.rs`, `crates/api/src/routes/tailor.rs`, `crates/api/src/routes/mod.rs`, `crates/api/src/lib.rs`, `crates/api/src/openapi.rs`: add `PROFILE_NOT_LOADED` (`409`), `POST /api/jobs/{id}/tailor` (fail-fast checks before AI call, `deep` tier default, Drive Doc uploads, `drive_artifacts` + `tailor_runs` persistence, `ai_usage_events`).
- [x] `crates/api/src/routes/jobs.rs`: include `latest_tailor: Option<TailorRunRecord>` in `JobDetailResponse`.
- [x] Integration tests: `503` (AI disabled), `404` (missing job), `409 PROFILE_NOT_LOADED`, `409 GOOGLE_NOT_CONNECTED`, and end-to-end mock AI + mock Drive persistence & `GET /api/jobs/{id}` hydration.
- Verify: `cargo test -p career-os-api`

### 5. Fixture sync & Web API mapping
- [x] Run `UPDATE_FIXTURES=1 cargo test -p career-os-api jobs_fixture` to update `web/src/__tests__/fixtures/jobs.json`.
- [x] `web/src/api/client.ts`, `web/src/api/jobs.ts`, `web/src/api/types.ts`: switch `careerApi.tailorJob` to `LIVE_ONLY`, map `TailorJobResponse`, hydrate `groundedBullets` in `jobDetailFromApi`.
- [x] Tests: `500`/`409` reject with `ApiError` (no demo fallback), detail mapping hydrates URLs & `groundedBullets`.
- Verify: `cd web && npm run typecheck && npm test`

### 6. Web UI (`RoleDetailSheet`)
- [x] `web/src/components/RoleDetailSheet.tsx`: remove `TAILOR_AVAILABLE` demo gate, show inline `Notice` on tailor error (`PROFILE_NOT_LOADED`, Google 409s, AI 503/502), show `"Regenerate Docs"` when artifacts exist, and update `Experience List.md` copy to `profile/` & synced project docs.
- [x] Update `web/src/__tests__/jobsMapping.test.tsx` (and/or add tailor UI tests).
- Verify: `cd web && npm run typecheck && npm test && npm run build`

### 7. Docs, full checks & PR
- [x] `docs/architecture.md` & `docs/trust.md`: document `POST /api/jobs/{id}/tailor`, `tailor_runs`, `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`, `psych-and-vibe.md` exclusion, and remove `tailor` from the Demo Data Rule exception.
- [x] Full checks (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `web` typecheck/test/build), PII scan incl. untracked files, open PR, keep `CI Gate` green.

Then `project-verify-archive` (deploy to M2, live check).

## Execution Notes / Deviations

- (None yet.)
