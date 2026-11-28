-- JOB-9: Replace legacy tier CHECK constraints and normalize historical rows to fast / balanced / deep.

CREATE TABLE evaluations_new (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('fast', 'balanced', 'deep')),
    model TEXT NOT NULL,
    overall_score REAL,
    archetype TEXT,
    blocks_json TEXT,
    report_md TEXT,
    rubric_score REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    provider TEXT
);

INSERT INTO evaluations_new (
    id, job_id, tier, model, overall_score, archetype, blocks_json, report_md, rubric_score, created_at, provider
)
SELECT
    id,
    job_id,
    CASE tier
        WHEN 'hydrogen' THEN 'fast'
        WHEN 'neon' THEN 'balanced'
        WHEN 'carbon' THEN 'deep'
        ELSE tier
    END,
    model,
    overall_score,
    archetype,
    blocks_json,
    report_md,
    rubric_score,
    created_at,
    provider
FROM evaluations;

DROP TABLE evaluations;
ALTER TABLE evaluations_new RENAME TO evaluations;

CREATE INDEX idx_evaluations_job_id ON evaluations (job_id);
CREATE INDEX idx_evaluations_job_tier ON evaluations (job_id, tier);

CREATE TABLE ai_usage_events_new (
    id TEXT PRIMARY KEY NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('fast', 'balanced', 'deep')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    job_id TEXT REFERENCES jobs (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    cost_usd REAL
);

INSERT INTO ai_usage_events_new (
    id, tier, provider, model, prompt_tokens, completion_tokens, latency_ms, success, error_message, job_id, created_at, cost_usd
)
SELECT
    id,
    CASE tier
        WHEN 'hydrogen' THEN 'fast'
        WHEN 'neon' THEN 'balanced'
        WHEN 'carbon' THEN 'deep'
        ELSE tier
    END,
    provider,
    model,
    prompt_tokens,
    completion_tokens,
    latency_ms,
    success,
    error_message,
    job_id,
    created_at,
    cost_usd
FROM ai_usage_events;

DROP TABLE ai_usage_events;
ALTER TABLE ai_usage_events_new RENAME TO ai_usage_events;

CREATE INDEX idx_ai_usage_events_created_at ON ai_usage_events (created_at);
CREATE INDEX idx_ai_usage_events_tier ON ai_usage_events (tier);
