-- Job workspace (JOB-14). Additive only, so existing rows are never rewritten.
-- Every table the parallel workspace units need is created here, so those
-- changes add no migrations of their own.

ALTER TABLE jobs ADD COLUMN archived_at TEXT;

-- Notes, tags and saved list views.
CREATE TABLE job_notes (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_job_notes_job_id ON job_notes (job_id);

CREATE TABLE job_tags (
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (job_id, tag)
);

CREATE TABLE saved_views (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    query_json TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Contacts and the per-job activity the user records. `kind` is validated by the
-- API, not by a CHECK, so new kinds never require rebuilding the table.
CREATE TABLE contacts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    company TEXT,
    email TEXT,
    phone TEXT,
    profile_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE job_contacts (
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, contact_id)
);

CREATE TABLE activities (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_activities_job_id ON activities (job_id, occurred_at);

-- Written automatically on every triage verdict and stage change.
CREATE TABLE job_events (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_job_events_created_at ON job_events (created_at);
CREATE INDEX idx_job_events_job_id ON job_events (job_id);

-- Weekly goals and similar numbers.
CREATE TABLE goals (
    key TEXT PRIMARY KEY NOT NULL,
    value INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Resume and cover letter studio.
ALTER TABLE tailor_runs ADD COLUMN instructions TEXT;
ALTER TABLE tailor_runs ADD COLUMN label TEXT;

CREATE TABLE tailor_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    standing_instructions TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Targeting and skills edited in the app (`kind`: targeting | skills).
CREATE TABLE profile_rules (
    kind TEXT PRIMARY KEY NOT NULL,
    body_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE profile_rule_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_profile_rule_revisions_kind ON profile_rule_revisions (kind, created_at);

-- Profile prose kept as Google Docs. `file_key` is the profile file it replaces
-- (identity, experience, psych-and-vibe, projects/<slug>). `markdown` is the
-- last export that could be read.
CREATE TABLE profile_docs (
    file_key TEXT PRIMARY KEY NOT NULL,
    drive_file_id TEXT NOT NULL UNIQUE,
    drive_url TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unspecified',
    markdown TEXT NOT NULL,
    drive_modified_time TEXT,
    synced_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sources manager.
ALTER TABLE sources ADD COLUMN options_json TEXT;

CREATE TABLE search_presets (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    query TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
