# JOB-14 — Job workspace

**Status:** In Progress · **Approval:** owner approved the staged plan on 2026-11-28, then asked on the same day to finish every stage without stopping for further go-aheads.

## Problem

The app is bare: little can be edited, files are out of reach, triage is weak and there is little color.

## How it should work

```
Discover ─▶ Triage (deck or list) ─▶ Job workspace ─▶ Apply ─▶ Follow up
                                      Overview · Fit · Documents · Activity
Home = Jobs (list or board)   Today = what needs you   Files = everything you own
```

- **Jobs** is the landing page. Every job has its own address.
- **Save / Skip** are the triage verdicts. "Applied" is a stage set on the job.
- **Files:** prose lives in Google Docs; targeting and skills are app forms (ADR-004).
- **Warm and colorful:** paper base, stage and score colors, company monograms, charts, motion, small celebrations.

## Delivery

Groundwork (one PR), then ten units that merge independently. Unit table and folders: `units.md`.

## Acceptance Criteria

Groundwork:
- [x] Migration `0008` is additive; on a copy of the live database every row survived and integrity checks passed.
- [x] Job list reports stage, follow-up and tags and hides archived jobs; verdicts and stage changes are recorded (`cargo test`).
- [x] Each route module registers its own routes and API docs; the exported spec kept all 42 operations.
- [x] Every screen renders in light and dark at desktop and 390px without sideways scrolling; each job has an address and tabs (`e2e/`).

Units:
- [ ] Each unit's row in `units.md` is delivered with tests and an e2e spec.
- [ ] Deployed live and smoke-checked.

## Docs Impact

`docs/architecture.md`, `docs/trust.md`, `docs/glossary.md`, `docs/adr/ADR-004-*`, `README.md`.
