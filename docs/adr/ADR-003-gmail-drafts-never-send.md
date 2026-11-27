# ADR-003: Gmail Drafts Only, Never Send

- **Status:** Accepted
- **Date:** 2026-11-28
- **Change:** JOB-6 (`project/changes/JOB-6-live-google-sync/`)

## Context

The job drawer lets the user write a follow-up or reply for an application. Saving it as a real Gmail draft means the user can review and send it from Gmail on any device. The `gmail.readonly` scope can't create drafts. The narrowest scope that can is `gmail.compose`, and Google's `gmail.compose` also allows `drafts.send` and `messages.send`. Outreach must stay under the user's control: generated or edited text can contain mistakes, and the zero-fabrication rule (`docs/trust.md` §3) applies to anything that goes out under their name.

## Decision

- Request `gmail.compose` (approved by Yaaf, 2026-11-27). The default scopes are now `gmail.readonly`, `gmail.compose`, `drive.file`, `calendar.events` and `userinfo.email`.
- The API calls only `users.drafts.create` and `users.drafts.update`. `GmailClient` has no send method. Tests assert that no request goes to a `/send` path (`integrations::gmail` and `routes::comms` tests).
- **Save to Gmail Drafts** requires `confirmed: true`, which the UI sets only after the user ticks "I have reviewed the recipient, subject and claims". The text is always saved locally first, so a Google error never loses it.
- Recipient and subject are sanitized: CR/LF are removed, so no extra headers such as `Bcc` can be injected. The body is sent as plain text.
- `/api/auth/google/status` reports `missing_scopes`. Existing grants made before this change need one reconnect, and Settings shows that prompt.

## Consequences

- The OAuth token could technically send mail. That risk is held by code and tests, not by Google's scope model. Any future change that adds sending needs a new ADR and an explicit per-message confirmation.
- The user re-consents once (Testing mode already asks for that weekly).
- A draft deleted or sent in Gmail is recreated on the next save (`update_draft` falls back to `create_draft` on 404).
