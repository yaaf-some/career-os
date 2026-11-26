-- Add connected_at tracking for Google OAuth Testing-mode 7-day refresh token lifecycle
ALTER TABLE oauth_tokens ADD COLUMN connected_at TEXT;

-- Cache Google Maps / Places commute lookups for LA-area on-site and hybrid roles
CREATE TABLE IF NOT EXISTS commute_cache (
    id TEXT PRIMARY KEY NOT NULL,
    origin_key TEXT NOT NULL,
    destination_query TEXT NOT NULL,
    resolved_address TEXT,
    place_id TEXT,
    distance_meters INTEGER,
    duration_seconds INTEGER,
    travel_mode TEXT NOT NULL DEFAULT 'DRIVE',
    estimate_source TEXT NOT NULL DEFAULT 'routes_api',
    maps_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commute_cache_lookup
    ON commute_cache (origin_key, destination_query, travel_mode);
CREATE INDEX IF NOT EXISTS idx_commute_cache_fetched_at
    ON commute_cache (fetched_at);
