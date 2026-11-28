CREATE TABLE IF NOT EXISTS tailor_runs (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('fast', 'balanced', 'deep')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    resume_artifact_id TEXT NOT NULL REFERENCES drive_artifacts (id) ON DELETE CASCADE,
    cover_artifact_id TEXT NOT NULL REFERENCES drive_artifacts (id) ON DELETE CASCADE,
    resume_md TEXT NOT NULL,
    cover_letter_md TEXT NOT NULL,
    grounded_bullets_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tailor_runs_job_id ON tailor_runs (job_id, created_at);
