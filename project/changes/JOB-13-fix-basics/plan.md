# JOB-13 Plan

Single PR (`fix/job-13-basics`).

- [x] Scanner: `posting-detail.mjs`, fill-after-filter in `scanAts`, `/fetch/postings`, `/sanitize`, description cap and line breaks.
- [x] API: fill or extend on re-ingest, `routes/descriptions.rs`, origin guard, fail-closed profile parsing, `.env.example` database path.
- [x] Web: Save/Skip triage and gesture fixes, all-pages job list, description UI, trust-bug fixes, demo data only in demo builds.
- [x] `e2e/` harness (`@playwright/test` 1.65.1) and specs.
- [x] Docs and full checks.
- [ ] Merge (owner), back up, deploy, run backfill, owner check.

## Execution Notes / Deviations

- Per-job fetch runs after filtering instead of switching on Greenhouse `fetchDetails`: that option needs a title filter the sidecar does not pass, and caps the number of fetches.
- Found during execution: the shared HTML-to-text helper cut descriptions at 4,000 characters and removed all line breaks.
