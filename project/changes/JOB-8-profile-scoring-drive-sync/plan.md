# JOB-8 Plan — Personalized Profile Scoring, Scanner Filters & Google Docs Project Sync

Branch per PR off `main`. Merge `origin/main` into a branch to catch up; never rebase pushed history. Each PR must pass `CI Gate` before the next starts, and merges only after human OK. Never commit PII or private `~/career-data` content into this repository.

## PR A — Profile Loader, Scanner Pre-Filters, Personalized Scoring & Rescore (`feat/job-8a-profile-scoring`)

> **Execution Notes:**
> - `AppConfig` reads `CAREER_OS_DATA_DIR` (default `/data`) because `docker-compose.yml` loads host `.env` via `env_file`, where `DATA_DIR` holds the macOS host path for the `${DATA_DIR}:/data:ro` bind mount.
> - `crates/api/src/profile/yaml.rs` implements a zero-dependency YAML subset parser instead of adding an external YAML crate, keeping builds hermetic/offline with zero `Cargo.lock` churn.

- [x] **1.1 Config & YAML parser** — `crates/api/src/config.rs`:
  - Add `data_dir: PathBuf` (`CAREER_OS_DATA_DIR`, default `/data`) and `google_drive_projects_folder_id: Option<String>` (`GOOGLE_DRIVE_PROJECTS_FOLDER_ID`) to `AppConfig`.
  - Verify: `cargo check -p career-os-api`

- [x] **1.2 Profile loader & digest builders** — `crates/api/src/profile/mod.rs` (new) + `crates/api/src/lib.rs`:
  - Parse `targeting.yml`, `skills.yml`, `identity.md`, `psych-and-vibe.md`, `experience.md`, and `projects/*.md` from `${DATA_DIR}/profile/` with YAML frontmatter (`status: verified | draft | tbd`, `updated_at`, `use_in`, `never_paste_verbatim_into_cv`).
  - Implement `build_hydrogen_digest(profile, cached_doc_digests)` and `build_neon_dossier(profile, cached_docs, max_chars)` excluding `tbd` sections from factual claims and preserving anti-hype guardrails.
  - Unit tests using tempdir synthetic profiles (never real PII) and missing-dir graceful fallback.
  - Verify: `cargo test -p career-os-api profile`

- [x] **1.3 Profile-driven scanner filters** — `scanner/src/filter.mjs`, `scanner/src/pipeline.mjs`, `scanner/src/server.mjs`, `crates/api/src/integrations/scanner.rs`, `crates/api/src/routes/sources.rs`:
  - Extend `resolveFilterOptions(portalsConfig)` and `filterJob`/`evaluateTitle` to accept configurable `target_title_keywords`, `excluded_seniority`, `excluded_domains`, `max_yoe`, `strict_location`.
  - Add default aerospace/hardware/MBSE domain exclusions in `filter.mjs` so non-software "Systems Engineer" roles are rejected out of the box.
  - Serialize `targeting.yml` `scanner_filters` into `portalsConfig` inside `scan_sources_filtered`.
  - Unit tests in `scanner/tests/filter.test.mjs`, `scanner/tests/server.test.mjs`, and `crates/api/src/routes/sources.rs`.
  - Verify: `cd scanner && npm test` and `cargo test -p career-os-api sources`

- [x] **1.4 Personalized Hydrogen & Neon prompts + breakdown schema** — `crates/api/src/ai/mod.rs`, `crates/api/src/state.rs`, `crates/api/src/routes/ai.rs`:
  - Add `HydrogenBreakdown` (`role_stack`, `level_reachability`, `vibe_culture`, `logistics_comp`) and `DealbreakerFlag` to `HydrogenScoreItem` (`#[serde(default)]` for backward compatibility).
  - Inject compiled Hydrogen Scoring Digest in `state.rs::score_pending_batch` and Neon Dossier in `routes/ai.rs::evaluate_job` (falling back to `CAREER_OS_PROFILE_SUMMARY` only if no profile exists).
  - Update `MockAiProvider` / fake bridge responses and parsing unit tests.
  - Verify: `cargo test -p career-os-api ai`

- [x] **1.5 Bulk rescore & profile status endpoints** — `crates/api/src/routes/ai.rs`, `crates/api/src/routes/profile.rs` (new), `crates/api/src/routes/mod.rs`, `crates/api/src/openapi.rs`:
  - `POST /api/ai/rescore` (resets eligible unapplied `pending_triage` / optional `skipped` jobs to `pending_scoring`, preserving `shortlisted`/`blacklisted`/jobs with `applications`, optionally runs a scoring batch).
  - `GET /api/profile/status` returning loaded local profile metadata, targeting summary, and synced project doc status.
  - Integration tests covering rescore safety guards and profile status response.
  - Verify: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`

## PR B — Google Drive Project Reports Sync & Auto-Digest (`feat/job-8b-drive-project-docs`)

- [x] **2.1 Migration 0005** — `crates/api/migrations/0005_profile_project_docs.sql`:
  - Create `project_docs` table (`id`, `drive_file_id` unique, `title`, `drive_url`, `modified_time`, `raw_markdown`, `digest_json`, `digested_at`, `synced_at`).
  - Verify: `cargo test -p career-os-api`

- [x] **2.2 OAuth scope & Drive folder export** — `crates/api/src/integrations/google_auth.rs`, `crates/api/src/integrations/drive.rs`:
  - Add `https://www.googleapis.com/auth/drive.readonly` to `DEFAULT_GOOGLE_SCOPES` and verify `missing_scopes()` flags grants without it.
  - Extend `DriveClient` (`list_files_in_folder` including `modifiedTime`, plus `export_doc_markdown` exporting Google Docs via `files/{id}/export?mimeType=text/markdown` with `text/plain` fallback).
  - Wiremock tests for listing, Markdown export, fallback, and folder scoping.
  - Verify: `cargo test -p career-os-api drive` and `cargo test -p career-os-api google_auth`

- [x] **2.3 Sync & Hydrogen auto-digest** — `crates/api/src/state.rs`, `crates/api/src/routes/profile.rs`, `crates/api/src/ai/mod.rs`, `crates/api/src/routes/ai.rs`:
  - Sync `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` during `sync_google_workspace` (when configured) and via `POST /api/profile/sync-docs`.
  - When a Doc is new or `modifiedTime` changed (and AI is enabled), run a compact Hydrogen pass (`build_project_doc_digest_prompt`) to store a structured Project Card in `digest_json` (`summary`, `stack`, `verified_claims`, `role_tags`).
  - Wire cached `project_docs` digests into `score_pending_batch` and full `raw_markdown` (budgeted) into `evaluate_job`.
  - Tests verifying unchanged `modifiedTime` skips AI re-digest, changed `modifiedTime` updates `digest_json`, and missing folder ID is a safe no-op.
  - Verify: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`

## PR C — Web UI Breakdown, Read-Only Profile Panel & Docs (`feat/job-8c-web-profile-breakdown`)

- [x] **3.1 Web types, mappers & fixtures** — `web/src/api/types.ts`, `web/src/api/jobs.ts`, `web/src/api/queries.ts`, `web/src/api/client.ts`, `web/src/api/demoData.ts`:
  - Update `ScoreBreakdown` to `roleStack`, `levelReachability`, `vibeCulture`, `logisticsComp` + optional `dealbreakerReason`.
  - Parse `tier1_json.breakdown` and `dealbreaker` in `jobSummaryFromApi` (keeping `null` when absent for old scored rows).
  - Add `ProfileStatusResponse` and React Query hooks (`useProfileStatusQuery`, `useSyncProjectDocsMutation`, `useRescoreJobsMutation`).
  - Verify: `cd web && npm run typecheck && npm test`

- [x] **3.2 Breakdown & Profile UI** — `web/src/components/RoleDetailDrawer.tsx`, `web/src/routes/TriageView.tsx`, `web/src/routes/SettingsView.tsx`:
  - Render 4-dimension breakdown bars and dealbreaker warning badge in `TriageView.tsx` and `RoleDetailDrawer.tsx`.
  - Add read-only **Candidate Profile & Project Docs** card in `SettingsView.tsx` showing file statuses (`verified`/`draft`/`tbd`), synced Drive Docs + digest status, **Sync Project Docs**, and **Rescore Pending Jobs** buttons.
  - Add Vitest unit tests covering breakdown rendering, backward compatibility with legacy `tier1_json`, and Settings profile panel actions.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`

- [x] **3.3 Config templates & living docs** — `.env.example`, `docker-compose.yml`, `README.md`, `docs/architecture.md`, `docs/trust.md`, `docs/glossary.md`:
  - Document `GOOGLE_DRIVE_PROJECTS_FOLDER_ID`, `DATA_DIR` profile layout, `drive.readonly` folder scoping, and rescore workflow.
  - Run PII grep and full workspace checks across Rust, Web, and Scanner.

## Verify & Archive

- [ ] **4.1 Live M2 verification** — Deploy updated images on the Mac mini, reconnect Google OAuth with `drive.readonly`, set `GOOGLE_DRIVE_PROJECTS_FOLDER_ID`, sync a Project Reports folder, confirm `GET /api/profile/status`, rescore existing jobs, and test filtered scan against an aerospace/hardware "Systems Engineer" posting.
- [ ] **4.2 `project-verify-archive`** — Verify all ACs, sync docs, archive `JOB-8-profile-scoring-drive-sync`, and update `project/STATE.md`.
