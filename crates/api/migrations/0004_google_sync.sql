-- JOB-6: link Gmail threads to applications, local email drafts, reminder notes.
ALTER TABLE gmail_threads ADD COLUMN link_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (link_source IN ('auto', 'manual'));
ALTER TABLE calendar_events ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS email_drafts (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    to_email TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    confirmed INTEGER NOT NULL DEFAULT 0,
    gmail_draft_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_drafts_application_id ON email_drafts (application_id);
