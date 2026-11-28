//! Calendar sync helpers (JOB-6 follow-up): UTC-normalized times and pruning of
//! events that were deleted or cancelled in Google Calendar.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use sqlx::SqlitePool;

use crate::error::AppError;

/// Google returns `dateTime` with the calendar's offset (`…T19:00:00+02:00`) or
/// an all-day `date` (`2026-11-29`). Stored times are UTC `…Z` so they compare
/// correctly as text. Unparseable input is returned unchanged.
pub fn normalize_event_time(raw: &str) -> String {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return dt
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true);
    }
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return d
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .to_rfc3339_opts(SecondsFormat::Secs, true);
    }
    raw.to_string()
}

/// Removes synced events that Google no longer returns inside the window it
/// actually listed: events ending at/after `window_start`, and — when the list
/// was truncated at the page limit — starting at/before `window_end` (the last
/// returned start). Events outside that window are left alone.
pub async fn prune_missing_events(
    pool: &SqlitePool,
    kept_gcal_ids: &[String],
    window_start: &str,
    window_end: Option<&str>,
) -> Result<u64, AppError> {
    let kept =
        serde_json::to_string(kept_gcal_ids).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let res = sqlx::query(
        r#"
        DELETE FROM calendar_events
        WHERE ends_at >= ?1
          AND (?2 IS NULL OR starts_at <= ?2)
          AND gcal_event_id NOT IN (SELECT value FROM json_each(?3))
        "#,
    )
    .bind(window_start)
    .bind(window_end)
    .bind(kept)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_offsets_and_all_day_dates_to_utc() {
        assert_eq!(
            normalize_event_time("2026-11-29T19:00:00+02:00"),
            "2026-11-29T17:00:00Z"
        );
        assert_eq!(
            normalize_event_time("2026-11-29T17:00:00Z"),
            "2026-11-29T17:00:00Z"
        );
        assert_eq!(normalize_event_time("2026-11-29"), "2026-11-29T00:00:00Z");
        assert_eq!(normalize_event_time("garbage"), "garbage");
    }

    async fn seeded() -> SqlitePool {
        let pool = crate::db::init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            "INSERT INTO calendar_events (id, gcal_event_id, kind, title, starts_at, ends_at) VALUES
             ('past','g-past','interview','Past','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z'),
             ('kept','g-kept','interview','Kept','2026-11-29T10:00:00Z','2026-11-29T11:00:00Z'),
             ('gone','g-gone','prep','Deleted in Google','2026-11-29T17:00:00Z','2026-11-29T17:30:00Z'),
             ('far','g-far','interview','Beyond page','2027-03-01T10:00:00Z','2027-03-01T11:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn ids(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar("SELECT id FROM calendar_events ORDER BY id")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn prunes_only_missing_events_inside_the_listed_window() {
        // Truncated page ending 2026-12-31: the March event is outside the window.
        let pool = seeded().await;
        let n = prune_missing_events(
            &pool,
            &["g-kept".into()],
            "2026-11-28T00:00:00Z",
            Some("2026-12-31T00:00:00Z"),
        )
        .await
        .unwrap();
        assert_eq!(n, 1);
        assert_eq!(ids(&pool).await, ["far", "kept", "past"]);

        // Complete list (no page limit hit): everything upcoming not returned goes.
        let n = prune_missing_events(&pool, &["g-kept".into()], "2026-11-28T00:00:00Z", None)
            .await
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(ids(&pool).await, ["kept", "past"]);
    }
}
