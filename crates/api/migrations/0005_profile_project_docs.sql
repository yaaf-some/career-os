-- JOB-8: Google Drive project reports cache and Hydrogen project-card digests.
CREATE TABLE IF NOT EXISTS project_docs (
    id TEXT PRIMARY KEY NOT NULL,
    drive_file_id TEXT NOT NULL,
    title TEXT NOT NULL,
    drive_url TEXT,
    modified_time TEXT,
    raw_markdown TEXT NOT NULL DEFAULT '',
    digest_json TEXT,
    digested_at TEXT,
    synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_docs_drive_file_id ON project_docs (drive_file_id);
