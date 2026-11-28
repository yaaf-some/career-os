# JOB-12 — Tailored Resume & Cover Letter Google Docs

**Status:** In Progress · **Surfaces:** `crates/api`, `web/`, `docs/` · **Linear:** `JOB-12` (optional)

## Problem / Context

`POST /api/jobs/{id}/tailor` is the only unbuilt v1 feature:

- `RoleDetailSheet.tsx` already has the **Tailor docs** tab with a disabled button (`TAILOR_AVAILABLE`), `drive_artifacts` already exists in `0001_init.sql` (`resume_doc`, `cover_doc`), and `web/src/api/client.ts::tailorJob` is the last remaining route with `fallbackOnServerError: true`.
- Candidates currently run deep A–G evaluations grounded in `DATA_DIR/profile/` and synced `project_docs`, but still have to manually assemble role-specific resumes and cover letters in Google Docs.

## Goals

- Implement `POST /api/jobs/{id}/tailor` generating a tailored Resume Google Doc and tailored Cover Letter Google Doc strictly grounded in `DATA_DIR/profile/` + synced `project_docs` (zero fabrication, zero `tbd` leaks, zero verbatim `psych-and-vibe.md` leaks).
- Upload both as native editable Google Docs via existing Google Drive v3 `drive.file` scope (HTML -> `application/vnd.google-apps.document` multipart upload) — **no new OAuth scopes or re-consent required**.
- Persist artifacts in `drive_artifacts` (`resume_doc`, `cover_doc`) and grounded evidence/markdown metadata in a new `tailor_runs` table (`0007_tailor_runs.sql`), returned in `POST /api/jobs/{id}/tailor` and `GET /api/jobs/{id}` so links and grounded bullets survive reloads.
- Enable the **Tailor docs** button in `RoleDetailSheet.tsx`, switch `careerApi.tailorJob` to `LIVE_ONLY`, and surface clear inline errors (`GOOGLE_NOT_CONNECTED`, `GOOGLE_RECONNECT_REQUIRED`, `PROFILE_NOT_LOADED`, AI bridge errors).

## Non-Goals

- Automatic PDF export, template cloning from an existing formatted Google Doc, or autonomous job submission.
- Requiring new Google OAuth scopes (e.g., Google Docs API) or writing into `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` (which remains strictly read-only).
- Editing or overwriting previously created Google Docs on re-tailor (re-tailoring creates fresh Docs so user edits in Drive are never clobbered).

## Design / Approach

1. **Tailoring dossier (`crates/api/src/profile/mod.rs::build_tailoring_dossier`):**
   - Requires `profile.loaded == true`.
   - Compiles `identity.md`, `experience.md`, `skills.yml` (`strong_production` + `working_hands_on` only, excluding `not_my_lane` and `active_learning_wip` as production claims), non-`tbd` `projects/*.md` (preserving `[WIP]` flags), and synced `project_docs` full Markdown, with explicit `source_file` headers and `strip_tbd_sections`.
   - Explicitly **excludes `psych-and-vibe.md`** (`never_paste_verbatim_into_cv`).
   - An optional latest deep evaluation summary may guide emphasis only, never add factual claims.
   - Untrusted `jd_text` is wrapped in explicit data-only delimiters (`<untrusted_job_description>`).

2. **AI prompt & parser (`crates/api/src/ai/mod.rs`):**
   - `build_tailor_prompt` + `parse_tailor_response` -> `TailorAiOutput { resume_title, resume_markdown, cover_letter_title, cover_letter_markdown, grounded_bullets: Vec<TailorEvidenceBullet> }`.
   - Defaults to `AiTier::Deep` (optional `tier` override in request), respects `state.ai_routing().await` + failover (`timeout_secs: Some(180)`, `max_tokens: Some(6000)`), and logs to `ai_usage_events`.
   - Validates non-empty resume, cover letter, and grounded bullets (each bullet has non-empty `source_file` and `text`).

3. **Drive HTML -> Google Doc (`crates/api/src/integrations/drive.rs`):**
   - Add `create_google_doc_from_html(access_token, name, folder_id, html)` using multipart upload (`metadata.mimeType = "application/vnd.google-apps.document"`, media part `Content-Type: text/html; charset=UTF-8`).
   - Add a pure-Rust HTML-escaped Markdown-to-HTML helper (`markdown_to_doc_html` supporting headings, paragraphs, bullet lists, bold/italic, horizontal rules).
   - Add optional `GOOGLE_DRIVE_OUTPUT_FOLDER_ID` env var (`AppConfig`, `.env.example`, `docker-compose.yml`); defaults to My Drive root if unset.

4. **Persistence (`crates/api/migrations/0007_tailor_runs.sql`) & Route (`crates/api/src/routes/tailor.rs`):**
   - `tailor_runs` table stores `id`, `job_id`, `tier`, `provider`, `model`, `resume_artifact_id`, `cover_artifact_id`, `resume_md`, `cover_letter_md`, `grounded_bullets_json`, `created_at`.
   - `POST /api/jobs/{id}/tailor`: validates upfront before calling the AI bridge:
     1. `state.ai.is_enabled()` -> `503`
     2. job exists -> `404`
     3. `profile.loaded` (unless `ai_demo_mode`) -> `409 PROFILE_NOT_LOADED`
     4. `state.require_google_access_token()` -> `409 GOOGLE_NOT_CONNECTED` / `GOOGLE_RECONNECT_REQUIRED`
   - Runs AI, creates both Google Docs via `state.drive`, inserts `drive_artifacts` + `tailor_runs`, and returns `TailorJobResponse` (OpenAPI documented).
   - `GET /api/jobs/{id}` (`routes/jobs.rs`) adds `latest_tailor: Option<TailorRunRecord>` so `jobDetailFromApi` hydrates both Doc URLs and `groundedBullets` across page reloads.

5. **Web (`web/src/api/client.ts`, `web/src/api/jobs.ts`, `web/src/components/RoleDetailSheet.tsx`, fixtures & tests):**
   - Switch `careerApi.tailorJob` to `LIVE_ONLY`, map API `TailorJobResponse` cleanly, and hydrate `groundedBullets` from `res.latest_tailor` in `jobDetailFromApi`.
   - Remove the `TAILOR_AVAILABLE` demo gate in `RoleDetailSheet.tsx`, show an inline error `Notice` on mutation failure (handling `PROFILE_NOT_LOADED`, Google 409s, AI 503/502), change the button label to `"Regenerate Docs"` when URLs already exist, and update source-file copy from hardcoded `Experience List.md` to `profile/` & synced project docs.
   - Regenerate `web/src/__tests__/fixtures/jobs.json` (`UPDATE_FIXTURES=1 cargo test -p career-os-api jobs_fixture`) and update tests.

## Acceptance Criteria

- [x] `build_tailoring_dossier` strips `tbd` sections, excludes `psych-and-vibe.md` and `not_my_lane`, includes `experience.md`, `identity.md`, `skills.yml`, non-`tbd` `projects/*.md`, and synced `project_docs`, and returns `None` when no profile is loaded (`cargo test`).
- [x] `markdown_to_doc_html` escapes raw HTML/XSS in untrusted text and renders headings, bullets, bold/italic, and paragraphs cleanly (`cargo test`).
- [x] `DriveClient::create_google_doc_from_html` sends multipart metadata `application/vnd.google-apps.document` + `text/html` media part and returns `DriveFileRecord` with `webViewLink` (`cargo test`).
- [x] `POST /api/jobs/{id}/tailor` fails fast before AI invocation with `503` (AI disabled), `404` (missing job), `409 PROFILE_NOT_LOADED` (no profile), and `409 GOOGLE_NOT_CONNECTED` (no OAuth token); on success it calls AI (`deep` tier by default), uploads two Google Docs, persists `drive_artifacts` + `tailor_runs`, records `ai_usage_events`, and `GET /api/jobs/{id}` returns the URLs + `grounded_bullets` (`cargo test`). Listed in OpenAPI.
- [x] Web `tailorJob` uses `LIVE_ONLY` (500/409 rejects with `ApiError`, no demo fallback outside `VITE_DEMO_MODE`), `RoleDetailSheet` enables **Tailor to Google Docs** on live, renders returned Doc links + grounded bullets, and displays inline errors on failure (`vitest`).
- [x] Full checks green: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `web`: `npm run typecheck && npm test && npm run build`, PII/secret scan clean.

## Docs Impact

- `docs/architecture.md`: document `POST /api/jobs/{id}/tailor`, `tailor_runs`, `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`, and update the Demo Data Rule (no remaining `tailor` exception).
- `docs/trust.md`: note `drive.file` creates tailored Google Docs (optional `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`; `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` stays strictly read-only) and `psych-and-vibe.md` is excluded from CV factual claims.
- `.env.example` & `docker-compose.yml`: document optional `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`.
- `project/STATE.md` at archive.
