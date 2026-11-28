# ADR-004: Google Docs and app rules as the profile source of truth

**Status:** Accepted (2026-11-28, JOB-14). Implemented by the profile-docs and rules units.

## Context

The profile was a set of files in `DATA_DIR`, mounted read-only. The owner could
not see or change them from the app, and a small YAML mistake silently changed
how jobs were scored. The owner wants to keep their prose in Google Drive and to
edit targeting and skills from the app.

## Decision

- **Prose** (identity, experience, voice notes, projects) lives in Google Docs the
  app creates with the existing `drive.file` scope. The app keeps the last export
  it could read (`profile_docs`). The user edits in Google Docs.
- **Targeting and skills** are structured data edited with app forms
  (`profile_rules`, with revisions). YAML files are imported once, on request.
- `DATA_DIR` stays mounted read-only. It remains the fallback for anything not
  yet moved, and the app never writes to it.
- One function, `load_effective_profile`, applies the layers: files, then app
  rules, then linked Docs.

## Consequences

- Only the user's explicit actions write profile content. AI output and job
  posting text never write to a profile source.
- A Doc that cannot be read keeps its last good copy, with the error shown.
- `psych-and-vibe` stays excluded from resume and cover letter dossiers whether
  it comes from a file or a Doc.
- The nightly database backup now contains profile content, so backups are as
  sensitive as the profile files.
- `GOOGLE_DRIVE_PROJECTS_FOLDER_ID` stays strictly read-only.
