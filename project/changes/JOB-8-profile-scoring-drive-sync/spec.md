# JOB-8 — Personalized Profile Scoring, Profile-Driven Scanner Filters & Google Docs Project Sync

**Status:** In Progress
**Issue:** JOB-8 (placeholder until created in Linear) · Branch `feat/job-8-profile-scoring`

## Problem / Context

`career-os` currently mounts the candidate's private data repository read-only at `/data:ro` (`DATA_DIR`, [docker-compose.yml](../../../docker-compose.yml)), yet scoring, evaluation, and scanning do not read it:

1. **Generic scoring prompt:** Both Hydrogen batch scoring ([crates/api/src/state.rs](../../../crates/api/src/state.rs)) and Neon deep evaluation ([crates/api/src/routes/ai.rs](../../../crates/api/src/routes/ai.rs)) only read `CAREER_OS_PROFILE_SUMMARY`, falling back to `"Senior systems/backend engineer evaluating role fit."`
2. **Missing score breakdown:** Hydrogen only returns a single numeric score, so `web/src/api/jobs.ts` sets `scoreBreakdown: null` and [RoleDetailDrawer.tsx](../../../web/src/components/RoleDetailDrawer.tsx) / [TriageView.tsx](../../../web/src/routes/TriageView.tsx) show no per-dimension breakdown.
3. **Hardcoded scanner filters:** [scanner/src/filter.mjs](../../../scanner/src/filter.mjs) hardcodes title/domain/YOE/location rules and [crates/api/src/routes/sources.rs](../../../crates/api/src/routes/sources.rs) only sends `max_posting_age_days` in `portalsConfig` ([crates/api/src/integrations/scanner.rs](../../../crates/api/src/integrations/scanner.rs)), letting irrelevant roles (such as aerospace or hardware "Systems Engineer") through.
4. **No Google Docs project-reports sync:** [crates/api/src/integrations/google_auth.rs](../../../crates/api/src/integrations/google_auth.rs) only requests `drive.file` (app-created files only), and [crates/api/src/integrations/drive.rs](../../../crates/api/src/integrations/drive.rs) has no support for listing a configured Drive folder and exporting existing/future Google Docs project reports into SQLite for scoring and future tailoring.
5. **Stale existing scores:** ~190 jobs already scored in SQLite used the generic fallback prompt and have no bulk rescore endpoint.

## Goals

1. **Read-only Profile Loader (`DATA_DIR`):** Add a Rust profile loader (`crates/api/src/profile/mod.rs`) reading `${DATA_DIR}/profile/` (`/data/profile/` in container; configurable via `DATA_DIR` env var defaulting to `/data` when present):
   - Parse `targeting.yml`, `skills.yml`, `identity.md`, `psych-and-vibe.md`, `experience.md`, and `projects/*.md`.
   - Parse YAML frontmatter (`status: verified | draft | tbd`, `updated_at`, `use_in`, optional `never_paste_verbatim_into_cv`).
   - Exclude `tbd` sections from factual claims, mark `draft` sections clearly, and fall back gracefully (with a surfaced status flag, never crashing) if `/data/profile/` is absent.
2. **Google Drive Project Reports Database:**
   - Add `https://www.googleapis.com/auth/drive.readonly` to `DEFAULT_GOOGLE_SCOPES` in `google_auth.rs` so existing `missing_scopes()` surfaces a reconnect prompt in Settings until re-consented.
   - Add `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` config (`AppConfig`, `.env.example`, `docker-compose.yml`), plus optional runtime setting override or display in Settings.
   - Extend `DriveClient` to list Google Docs in that specific folder (including `modifiedTime`) and export each Google Doc as `text/markdown` with `text/plain` fallback (skipping trashed or non-Doc files safely).
   - Add migration `0005_profile_project_docs.sql` creating `project_docs` (`id`, `drive_file_id`, `title`, `drive_url`, `modified_time`, `raw_markdown`, `digest_json`, `digested_at`, `synced_at`).
   - Run project Docs sync inside `sync_google_workspace` (when `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` is set) and expose `POST /api/profile/sync-docs`.
   - When a Doc is newly added or its `modifiedTime` advances, run a compact Hydrogen pass to extract a structured Project Card JSON (`summary`, `stack`, `verified_claims`, `role_tags`) cached in `digest_json`.
3. **Personalized Hydrogen Scoring + 4-Dimension Breakdown:**
   - Compile a compact **Hydrogen Scoring Digest** from `targeting.yml`, `skills.yml`, vibe green/red flags (`psych-and-vibe.md`), key local project one-liners, and cached `project_docs` digests.
   - Update `HydrogenScoreItem` and `build_hydrogen_triage_batch_prompt` to score `0–100` using configurable weights from `targeting.yml` (default: `role_stack` 35, `level_reachability` 25, `vibe_culture` 25, `logistics_comp` 15) plus optional `dealbreaker: { triggered: bool, reason: Option<String> }` that caps/flags mismatches and recommends `skipped`.
   - Keep `HydrogenScoreItem` deserialization backward-compatible with legacy `tier1_json` rows lacking `breakdown` or `dealbreaker`.
4. **Personalized Neon Deep Evaluation:**
   - Compile a structured **Neon Dossier** from verified `identity.md`, `experience.md`, `skills.yml`, `psych-and-vibe.md`, local `projects/*.md`, and full `raw_markdown` of relevant `project_docs` (bounded to stay within prompt token limits).
   - Update `build_neon_evaluation_prompt` to enforce zero fabrication, anti-hype guardrails, and Blocks A–G grounded in actual candidate proof points and vibe/culture fit.
5. **Profile-Driven Scanner Pre-Filters:**
   - Serialize `targeting.yml` `scanner_filters` into `portalsConfig` sent from `crates/api/src/routes/sources.rs` → `scanner/src/server.mjs` → `pipeline.mjs` & `filter.mjs`.
   - Support configurable `max_yoe`, `max_posting_age_days`, `strict_location`, `target_title_keywords`, `excluded_seniority`, and `excluded_domains` in `filter.mjs` while preserving safe built-in defaults (including aerospace/hardware/MBSE domain exclusions so non-software "Systems Engineer" postings are rejected).
6. **Bulk Rescore of Existing Unapplied Jobs:**
   - Add `POST /api/ai/rescore` (body e.g. `{ include_skipped?: bool, limit?: i64 }`) that resets eligible unapplied jobs (`pending_triage`, and optionally `skipped` — never touching `shortlisted` with active applications, `blacklisted`, or jobs in `applications`) back to `pending_scoring`, optionally running an immediate Hydrogen scoring batch and returning queued/scored counts.
7. **Read-Only Profile Status & Score Breakdown UI:**
   - Add `GET /api/profile/status` returning loaded local profile files (name, status, `updated_at`), active `targeting.yml` summary (roles, YOE band, weights), and synced `project_docs` (title, `modified_time`, digest status, Drive link).
   - Map `tier1_json.breakdown` and `dealbreaker` in `web/src/api/jobs.ts` and render the 4-dimension breakdown in `RoleDetailDrawer.tsx` and `TriageView.tsx`.
   - Add a read-only **Candidate Profile & Project Docs** panel in `SettingsView.tsx` with **Sync Project Docs** and **Rescore Pending Jobs** actions.

## Non-Goals

- Editing `/data/profile/*` from the web UI (the `/data:ro` container bind mount stays strictly read-only).
- Resume and cover-letter generation into Google Docs (`/api/jobs/{id}/tailor`) — tracked as a separate follow-up issue that builds directly on this profile loader and `project_docs` cache.
- Moving GCP OAuth out of Testing mode or touching Cloudflare configuration.
- Modifying `ai-bridge` CLI execution semantics (it remains tool-less per ADR-002).

## Security & Trust Boundary Notes

- **Read-only host mount:** `DATA_DIR` remains mounted `:ro` inside the `app` container; the API never writes to `/data`.
- **Scoped Drive reads:** Although Google's OAuth scope is `drive.readonly`, `DriveClient` queries strictly within `'${GOOGLE_DRIVE_PROJECTS_FOLDER_ID}' in parents and trashed = false` and never enumerates or downloads unrelated Drive files.
- **Untrusted job text isolation:** Job descriptions remain untrusted data evaluated through the tool-less `ai-bridge`; synced Google Docs are user-authored source-of-truth documents cached in SQLite (and encrypted OAuth tokens remain untouched).
- **Public repo hygiene:** Zero PII, personal profile text, or real project metrics may appear in `career-os` source, fixtures, or documentation.

## Acceptance Criteria

- [ ] **AC1 — Profile Loader:** With a test `DATA_DIR/profile/` directory containing `targeting.yml`, `skills.yml`, `identity.md`, `psych-and-vibe.md`, `experience.md`, and `projects/*.md`, `GET /api/profile/status` returns parsed file statuses (`verified`/`draft`/`tbd`), weights, and `tbd` exclusions; when `DATA_DIR/profile/` is missing, the API boots cleanly and falls back to `CAREER_OS_PROFILE_SUMMARY` / default text.
- [ ] **AC2 — Profile-Driven Scanner Filters:** Unit tests in `scanner/` verify that `portalsConfig` overrides (`target_title_keywords`, `excluded_seniority`, `excluded_domains`, `max_yoe`) are applied, and default + configured domain exclusions reject aerospace/hardware "Systems Engineer" postings while accepting software Platform/DevOps/SRE postings. Rust `sources.rs` test verifies `portalsConfig` includes serialized `targeting.yml` `scanner_filters`.
- [ ] **AC3 — Hydrogen Personalized Prompt & 4-Dimension Breakdown:** `build_hydrogen_triage_batch_prompt` embeds the compiled Hydrogen Scoring Digest (targeting, skills, vibe green/red flags, project cards, dealbreakers) and parses `breakdown` (`role_stack`, `level_reachability`, `vibe_culture`, `logistics_comp`) + `dealbreaker` while remaining backward-compatible with legacy `tier1_json` payloads.
- [ ] **AC4 — Neon Personalized Prompt:** `build_neon_evaluation_prompt` embeds the compiled Neon Dossier (including relevant full `project_docs.raw_markdown` bounded by a character/token budget) and enforces zero-fabrication / anti-hype instructions.
- [ ] **AC5 — Google Drive Project Docs Scope & Sync:** `DEFAULT_GOOGLE_SCOPES` includes `drive.readonly`, `missing_scopes()` flags existing grants lacking it, and wiremock tests verify `DriveClient` lists Docs strictly in `GOOGLE_DRIVE_PROJECTS_FOLDER_ID`, exports Markdown (with `text/plain` fallback), upserts `project_docs`, and only re-runs Hydrogen digest generation when `modifiedTime` changes.
- [ ] **AC6 — Bulk Rescore (`POST /api/ai/rescore`):** Integration tests verify unapplied `pending_triage` (and optional `skipped`) jobs reset to `pending_scoring`, jobs with `applications` rows or `blacklisted` status are never reset, and a Hydrogen batch executes when requested.
- [ ] **AC7 — Web UI & Contract Fixtures:** `web/src/api/jobs.ts` maps `breakdown` and `dealbreaker` from `tier1_json`; `RoleDetailDrawer.tsx` and `TriageView.tsx` display the 4-dimension scores; `SettingsView.tsx` displays read-only profile status, synced `project_docs`, **Sync Project Docs**, and **Rescore** actions; Vitest + fixture tests pass.
- [ ] **AC8 — Full Repo Checks & PII Hygiene:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `scanner` `npm test`, `web` `npm run typecheck && npm test && npm run build`, and PII scan all pass.
- [ ] **AC9 — Live M2 Verification:** On the live Mac mini stack (`career-os`), reconnect Google OAuth with `drive.readonly`, sync a test Project Reports Drive folder, verify `/api/profile/status` sees `~/career-data/profile/`, rescore existing jobs, and inspect score breakdowns + filtered aerospace rejections.

## Docs Impact

- `docs/architecture.md` — Document `/data/profile/` loader, `project_docs` Google Drive sync/digest flow, and profile-driven scanner `portalsConfig`.
- `docs/trust.md` — Document `drive.readonly` folder-scoped restriction and `tbd`/anti-hype profile boundaries.
- `docs/glossary.md` — Add `project_docs` and `targeting.yml` entries.
- `.env.example`, `docker-compose.yml`, `README.md` — Add `DATA_DIR` awareness (if needed in `app` env) and `GOOGLE_DRIVE_PROJECTS_FOLDER_ID`.
- `project/STATE.md` — Update current status after verification and archive.
