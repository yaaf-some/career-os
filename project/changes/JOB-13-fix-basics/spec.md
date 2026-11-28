# JOB-13 — Fix the broken basics

**Status:** In Review · **Surfaces:** `crates/api`, `scanner/`, `web/`, `e2e/`, `docs/` · **Approval:** owner approved the staged "job workspace" plan on 2026-11-28 (Stage 1 of 3).

## Problem

The live app is hard to use: most jobs have no description, "Approve" is saved as "Saved" and comes back, only 50 jobs of any status load, the swipe card does not follow the finger, and a few screens invent data.

## Goals

- Descriptions: fetch them for oversized Greenhouse boards, fill or complete them on rescan, and let the user fetch, paste or bulk-backfill them.
- Triage: Save and Skip only; every waiting job loads; drag, cancel, held keys and failed saves behave.
- Trust: no made-up email recipient, no sample link outside demo builds, local reminder times, no demo data on network errors.
- Safety: refuse cross-site writes; unreadable profile files are not used.
- A Playwright harness that runs against synthetic data only.

## Non-Goals

The redesign (JOB-14): job pages, new design system, Drive profile docs, rules forms.

## Acceptance Criteria

- [x] `fetchPostings` calls only fixed ATS API hosts; unsupported, closed and failed postings are reported (`scanner` tests).
- [x] An oversized Greenhouse board gets bodies for accepted postings, and description filters apply again.
- [x] Descriptions keep paragraphs and bullets and are no longer cut at 4,000 characters.
- [x] Rescan fills empty or cut-off descriptions and never replaces a complete one (`cargo test`).
- [x] Backfill requeues waiting jobs, and requeues AI-skipped jobs only when asked; user-skipped jobs stay skipped.
- [x] Cross-site writes get `403`; unreadable YAML or frontmatter excludes the file (`cargo test`).
- [x] The web loads all job pages; a cancelled drag decides nothing; network errors are errors (`vitest`).
- [x] In a real browser at desktop and 390px widths, the card follows a drag and Save works; pasted text is cleaned (`e2e/`).
- [ ] After deploy: backfill on the live app, and the owner confirms descriptions and triage on their phone.

## Docs Impact

`docs/architecture.md`, `docs/trust.md`, `e2e/README.md`.
