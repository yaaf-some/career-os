# JOB-14 units

Web folders are under `web/src/features/`. API paths are under `crates/api/src/`.

| # | Unit | Owns | Change |
|---|---|---|---|
| 1 | Jobs list and board | `jobs/`, `routes/jobs.rs` | Search, filters, sort, saved views (`saved_views`), drag between stages, bulk actions, quick add with description |
| 2 | Job overview and fit | `job/overview/`, `job/fit/`, `routes/job_edit.rs`, `routes/ai.rs` | Edit any field, archive/delete, notes, tags, description, evaluation report and history, tier picker, rescore one |
| 3 | Contacts and activity | `job/activity/`, `routes/contacts.rs`, `routes/comms.rs` | Contacts, timeline (`activities`, `job_events`), link/unlink Gmail threads, email drafts, calendar reminders with kind and links |
| 4 | Resume and letter studio | `job/documents/`, `routes/tailor.rs` | In-app preview, regenerate with instructions, standing instructions, version history, Drive links. Never overwrites a Doc; claims stay grounded |
| 5 | Triage deck | `triage/`, `routes/triage.rs` | Real card stack with flick physics, richer card, buttons and keys, undo history, list mode, end-of-queue celebration |
| 6 | Scoring and search rules | `settings/rules/`, `routes/rules.rs`, `profile/rules.rs`, `profile/yaml.rs`, `profile/mod.rs`, `scanner/src/filter.mjs` | Forms for targeting and skills, one-time YAML import with a proper parser, validation, locations passed to scanner, rescore |
| 7 | Profile docs in Drive | `files/profile-docs/`, `routes/profile_docs.rs`, `routes/profile.rs`, `profile/drive_docs.rs`, `integrations/drive.rs` | Create Docs from the profile files (`drive.file`), open and sync, keep the last good copy, prune removed project docs. `psych-and-vibe` stays out of resumes. Originals untouched |
| 8 | Sources manager | `sources/`, `routes/sources.rs`, `integrations/scanner.rs` | Edit, delete, scan one, errors and last scan, board links, "add anyway" from the filtered list, editable search presets (`search_presets`), Ashby embed opt-in (`sources.options_json`) |
| 9 | Today and momentum | `today/`, `routes/workspace.rs` | Real Gmail and Calendar links, follow-up done/snooze, weekly goal (`goals`), funnel charts, streaks and small wins (`job_events`) |
| 10 | Files hub, connections, mobile | `files/` (except `profile-docs/`), `settings/connections/`, `settings/appearance/`, `routes/files.rs`, `routes/auth.rs`, `routes/commute.rs`, `routes/settings.rs`, `components/AppShell.tsx`, `components/CommandPalette.tsx`, `web/public/`, `web/index.html` | Every generated doc and Drive folder in one place, Google disconnect and account, Maps status and commute Save, Linear links, accent and density, mobile nav, safe areas, icons, command palette job search |

## Conventions

- **API:** add handlers to your module's `router()` and `Doc` list. Do not edit `lib.rs`, `openapi.rs` or `routes/mod.rs`.
- **Schema:** `0008_job_workspace.sql` already has your tables. Add no migrations; report if one is truly needed.
- **Job rows:** select with `routes::jobs::JOB_COLUMNS`.
- **Profile:** read it with `profile::load_effective_profile`.
- **Tests:** build state with `AppState::for_test(pool, config, ai)`. After changing a shared response shape run `UPDATE_FIXTURES=1 cargo test -p career-os-api fixture`; never hand-merge fixtures.
- **Web calls:** new ones go in your folder's `api.ts`, built on `request` from `@/api/core`, with react-query hooks in the same folder. Invalidate with `queryKeys` from `@/api/queries`. No demo data is required.
- **Look:** use `@/components/ui` (`PageHeader`, `Monogram`, `ScoreRing`, `StageBadge`, `StatTile`, `Notice`, `Confetti`) and the tokens in `index.css` and `@/lib/stages`. Do not hardcode colors.
- **Shared files** (`router.tsx`, `index.css`, `api/types.ts`, `api/client.ts`, `api/jobs.ts`, `components/ui/`): change only if your unit cannot work without it, keep the edit small and additive, and say so in your report.
- **Docs:** write your doc notes to `notes/<unit-number>.md`. Do not edit `project/STATE.md` or `docs/`.
