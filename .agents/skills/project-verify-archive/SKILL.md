---
name: project-verify-archive
description: "Verify a completed change against spec.md acceptance criteria, sync affected docs/, archive the change folder, update project/STATE.md, and stop for human approval before PR/merge."
user-invocable: true
argument-hint: "[issue-id or path to change folder]"
---

# project-verify-archive

Close the loop on a completed change so tests pass, Living Docs stay accurate, and Elephant state stays current.

## Procedure

1. **Verify Acceptance Criteria.**
   - Check every item in `project/changes/<id>-<slug>/spec.md` under **Acceptance Criteria**.
   - Run full relevant checks (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `npm run typecheck`, `npm test`, `npm run build`, PII grep). Record exact pass/fail results.
   - If any criterion fails, fix it or report the blocker — do NOT archive a failing change.
2. **Sync Living Docs.**
   - Review the **Docs Impact** section of `spec.md` and update every affected file in `docs/` (`charter.md`, `architecture.md`, `glossary.md`, `trust.md`).
   - Add a new `docs/adr/ADR-NNN-*.md` entry if this change introduced a durable architectural decision.
3. **Archive the Change.**
   - Update `spec.md` status to `Verified` and ensure all checkboxes in `spec.md` and `plan.md` are checked.
   - Move `project/changes/<id>-<slug>/` to `project/changes/archive/<id>-<slug>/`.
4. **Update Elephant State (`project/STATE.md`).**
   - Refresh `Last updated`, `Current Focus`, `Active Branches`, `Recent Decisions`, and `Standing Gotchas`.
   - Keep `project/STATE.md` strictly under 50 lines.
5. **Prepare PR & Hard Gate.**
   - Reference `<id>` in commit messages and PR title/body.
   - Summarize what was verified, which docs were updated, and stop for human approval before merging to `main` or closing the tracking issue.
