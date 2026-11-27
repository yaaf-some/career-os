-- JOB-5: record bridge cost and which CLI produced an evaluation.
ALTER TABLE ai_usage_events ADD COLUMN cost_usd REAL;
ALTER TABLE evaluations ADD COLUMN provider TEXT;
