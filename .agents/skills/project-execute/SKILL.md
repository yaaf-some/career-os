---
name: project-execute
description: "Execute an approved project/changes/<id>-<slug>/plan.md step by step using Goldfish discipline (focused context, live checkbox updates, per-task verification)."
user-invocable: true
argument-hint: "[issue-id or path to change folder]"
---

# project-execute

Implement an approved change plan cleanly, keeping execution focused and verifiable.

## Preconditions

- `project/changes/<id>-<slug>/spec.md` and `plan.md` MUST exist and be approved by the user. If `spec.md` is still `Proposed`, stop and ask for approval first.

## Procedure

1. **Check git branch.** Confirm you are on a feature branch (e.g., `feat/<id>-<slug>` branched from `main`). Create it from `main` if it does not exist yet.
2. **Load focused context (Goldfish rule).** Read `spec.md`, `plan.md`, and only the target files listed in the current task. Do not drag unrelated conversation history or unrelated docs into execution.
3. **Update `spec.md` status.** Set `Status: In Progress` while working.
4. **Execute `plan.md` in order.**
   - For each unchecked task:
     - Implement the change cleanly, respecting all invariants in `docs/architecture.md` and `docs/trust.md`.
     - If spawning subagents for independent tasks, pass only the relevant task, `spec.md`, and explicit directory/file boundaries.
     - Run the task's `Verify` check (`cargo fmt --check`, `cargo clippy`, `cargo test`, `npm run typecheck`, `npm test`, `npm run build`, etc.).
     - Check off `[x]` in `plan.md` immediately after the task passes.
5. **Handle deviations transparently.**
   - If you hit a surprise that changes scope, acceptance criteria, or architecture: **stop**, record it in `plan.md` under `Execution Notes / Deviations`, and align with the user before proceeding.
   - Minor implementation notes can be logged under `Execution Notes / Deviations` without blocking.
6. **Hand off to verification.** When all implementation tasks are checked off, report completion and proceed to `project-verify-archive` (or run `project-handoff` if pausing mid-way).
