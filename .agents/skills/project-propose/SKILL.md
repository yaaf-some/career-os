---
name: project-propose
description: "Propose a non-trivial change (OpenSpec + GSD): read project/STATE.md, docs/, and the relevant issue, then draft project/changes/<id>-<slug>/spec.md and plan.md and stop for human approval before coding."
user-invocable: true
argument-hint: "[issue-id or feature description]"
---

# project-propose

Turn an issue or new feature idea into a concise, verifiable `spec.md` and `plan.md` before any implementation begins.

## When to Use

- Any non-trivial feature, refactor, workflow change, or architectural modification.
- Skip for trivial 1-line bugfixes or typos.

## Procedure

1. **Load Elephant context.** Read `project/STATE.md` and only the specific files in `docs/` (`charter.md`, `architecture.md`, `glossary.md`, `trust.md`, `docs/adr/`) relevant to this change.
2. **Resolve the issue.**
   - If an issue ID (e.g., `JOB-<N>` or GitHub `#<N>`) was passed, fetch its details.
   - If no issue exists yet, proceed with a clear local slug or ask whether to create one first.
3. **Explore affected code.** Inspect the exact files in `crates/`, `web/`, `scanner/`, or `deploy/` this change will touch so the spec and plan are grounded in real paths and constraints — never guess.
4. **Resolve ambiguities.** If any design decision is unclear, ask concise questions (one at a time if multiple) with a recommended option.
5. **Create the change folder.** Create `project/changes/<id>-<slug>/` containing:
   - `spec.md`: Status (`Proposed`), Problem/context, Goals, Non-Goals, Design/Approach, concrete Acceptance Criteria, and Docs Impact.
   - `plan.md`: Small, ordered, verifiable tasks with explicit file paths and verify commands (scoped cleanly for Goldfish execution).
6. **Hard Gate — STOP for Human Approval.**
   - Present a crisp summary of `spec.md` and `plan.md`.
   - **Do NOT write application code or edit target files until the user explicitly approves the spec and plan.**
   - Once approved, update `spec.md` status from `Proposed` to `Approved` and hand off to `project-execute`.
