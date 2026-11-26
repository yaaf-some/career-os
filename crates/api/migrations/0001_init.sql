-- Career OS SQLite schema (WAL mode configured at connection time)

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY NOT NULL,
    company TEXT NOT NULL,
    provider TEXT NOT NULL,
    careers_url TEXT NOT NULL,
    board_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    last_scanned_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_enabled ON sources (enabled);
CREATE INDEX IF NOT EXISTS idx_sources_provider_board ON sources (provider, board_id);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    canonical_key TEXT NOT NULL,
    url TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    workplace_type TEXT CHECK (workplace_type IS NULL OR workplace_type IN ('remote', 'hybrid', 'onsite', 'unknown')),
    yoe_min INTEGER,
    yoe_max INTEGER,
    yoe_label TEXT,
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency TEXT,
    posted_at TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('ats_board', 'gmail_alert', 'reddit', 'twitter', 'manual', 'discovery')),
    source_id TEXT REFERENCES sources (id) ON DELETE SET NULL,
    jd_text TEXT,
    guard_flags_json TEXT,
    triage_status TEXT NOT NULL DEFAULT 'pending_scoring' CHECK (triage_status IN ('pending_scoring', 'pending_triage', 'shortlisted', 'skipped', 'blacklisted')),
    tier1_score REAL,
    tier1_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_canonical_key ON jobs (canonical_key);
CREATE INDEX IF NOT EXISTS idx_jobs_triage_status ON jobs (triage_status);
CREATE INDEX IF NOT EXISTS idx_jobs_tier1_score ON jobs (tier1_score);
CREATE INDEX IF NOT EXISTS idx_jobs_triage_score ON jobs (triage_status, tier1_score);
CREATE INDEX IF NOT EXISTS idx_jobs_source_id ON jobs (source_id);

CREATE TABLE IF NOT EXISTS filtered_audit (
    id TEXT PRIMARY KEY NOT NULL,
    canonical_key TEXT NOT NULL,
    url TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    reason_code TEXT NOT NULL,
    reason_detail TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('ats_board', 'gmail_alert', 'reddit', 'twitter', 'manual', 'discovery')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_filtered_audit_created_at ON filtered_audit (created_at);
CREATE INDEX IF NOT EXISTS idx_filtered_audit_reason_code ON filtered_audit (reason_code);
CREATE INDEX IF NOT EXISTS idx_filtered_audit_canonical_key ON filtered_audit (canonical_key);

CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('hydrogen', 'neon', 'carbon')),
    model TEXT NOT NULL,
    overall_score REAL,
    archetype TEXT,
    blocks_json TEXT,
    report_md TEXT,
    rubric_score REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_evaluations_job_id ON evaluations (job_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_job_tier ON evaluations (job_id, tier);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'shortlisted' CHECK (stage IN ('shortlisted', 'applied', 'recruiter', 'interviewing', 'offer', 'closed')),
    applied_at TEXT,
    next_followup_at TEXT,
    followup_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    gmail_thread_id TEXT,
    linear_issue_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_id ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications (stage);
CREATE INDEX IF NOT EXISTS idx_applications_next_followup_at ON applications (next_followup_at);

CREATE TABLE IF NOT EXISTS drive_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('resume_doc', 'cover_doc', 'jd_doc', 'resume_pdf')),
    drive_file_id TEXT NOT NULL,
    drive_url TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drive_artifacts_job_id ON drive_artifacts (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_artifacts_file_id ON drive_artifacts (drive_file_id);

CREATE TABLE IF NOT EXISTS gmail_threads (
    id TEXT PRIMARY KEY NOT NULL,
    thread_id TEXT NOT NULL,
    application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
    subject TEXT,
    from_email TEXT,
    labels_json TEXT,
    snippet TEXT,
    needs_reply INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gmail_threads_thread_id ON gmail_threads (thread_id);
CREATE INDEX IF NOT EXISTS idx_gmail_threads_needs_reply ON gmail_threads (needs_reply);
CREATE INDEX IF NOT EXISTS idx_gmail_threads_application_id ON gmail_threads (application_id);

CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    gcal_event_id TEXT NOT NULL,
    application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('followup', 'prep', 'interview')),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    html_link TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_events_gcal_event_id ON calendar_events (gcal_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_application_id ON calendar_events (application_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at ON calendar_events (starts_at);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    account_email TEXT,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    token_type TEXT,
    scope TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_tokens_provider ON oauth_tokens (provider);

CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY NOT NULL,
    run_type TEXT NOT NULL CHECK (run_type IN ('ats_scan', 'social_scan', 'gmail_sync', 'tier1_score', 'manual_ingest')),
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    items_fetched INTEGER NOT NULL DEFAULT 0,
    items_ingested INTEGER NOT NULL DEFAULT 0,
    items_filtered INTEGER NOT NULL DEFAULT 0,
    items_errored INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_type_started ON sync_runs (run_type, started_at);

CREATE TABLE IF NOT EXISTS sync_cursors (
    cursor_key TEXT PRIMARY KEY NOT NULL,
    cursor_value TEXT NOT NULL,
    meta_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
    id TEXT PRIMARY KEY NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('hydrogen', 'neon', 'carbon')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    job_id TEXT REFERENCES jobs (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_tier ON ai_usage_events (tier);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
