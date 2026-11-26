---
name: project-handoff
description: "Compress current session progress, open threads, next concrete step, and newly discovered gotchas into project/STATE.md (<50 lines) for clean cross-session continuity."
user-invocable: true
argument-hint: "[optional short note on where we're pausing]"
---

# project-handoff

Write a crisp, high-signal Elephant handoff to `project/STATE.md` whenever pausing work, switching topics, or ending a session.

## Procedure

1. **Read current `project/STATE.md`** and check `git status -sb` plus any active folders in `project/changes/` (excluding `archive/`).
2. **Compress, don't append endlessly.** Rewrite `project/STATE.md` in place so it stays **under 50 lines** and contains only what the next fresh session needs to start immediately:
   - `Last updated` date
   - **Current Focus:** active phase/change and exact next concrete step
   - **Active Branches / In-Flight Work:** branch names and one-line status
   - **Upcoming Priorities:** top 3-5 next items
   - **Recent Decisions:** brief pointers to `docs/adr/`
   - **Standing Gotchas:** active environment/repo pitfalls only (prune resolved ones)
3. **Check for uncaptured durable knowledge.**
   - If the session produced a durable architectural decision or new terminology, record it in `docs/adr/` or `docs/glossary.md` rather than stuffing it into `STATE.md`.
4. **Report back.** Show a short summary of what was written to `project/STATE.md` so the next session can pick up cold.
