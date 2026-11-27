use std::time::Duration;

use serde::Deserialize;
use tokio::{
    sync::watch,
    time::{interval, MissedTickBehavior},
};

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    routes::{settings::SyncRunRecord, sources::run_ats_scan},
    state::AppState,
};

const HOURLY_SECS: u64 = 3600;
const DAILY_SECS: u64 = 86_400;
const THREE_DAYS_SECS: u64 = 259_200;

#[derive(Debug, Deserialize)]
struct RedditFeedConfig {
    url: String,
    label: String,
}

pub fn spawn_scheduler(state: AppState, shutdown_rx: watch::Receiver<bool>) {
    if !state.config.scheduler_enabled {
        tracing::info!("background scheduler disabled via config");
        return;
    }

    let sync_secs = state.config.google_sync_interval_hours * 3600;
    tracing::info!(
        google_sync_hours = state.config.google_sync_interval_hours,
        "spawning background scheduler (google sync, hourly scoring, daily reddit, 3-day ATS)"
    );

    // Every GOOGLE_SYNC_INTERVAL_HOURS (default 12): Gmail/Calendar sync + linking
    {
        let st = state.clone();
        let mut rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(sync_secs));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            ticker.tick().await; // skip immediate t=0 tick
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if let Err(err) = run_google_sync(&st).await {
                            tracing::warn!(error = %err, "scheduled google sync failed");
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Hourly: batched hydrogen scoring
    {
        let st = state.clone();
        let mut rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(HOURLY_SECS));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            ticker.tick().await; // skip immediate t=0 tick
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if let Err(err) = run_hourly_scoring(&st).await {
                            tracing::error!(error = %err, "hourly scoring failed");
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Daily: Reddit RSS scan
    {
        let st = state.clone();
        let mut rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(DAILY_SECS));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if let Err(err) = run_daily_social_scan(&st).await {
                            tracing::error!(error = %err, "daily social scan failed");
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Every 3 days: Enabled ATS board scan
    {
        let st = state;
        let mut rx = shutdown_rx;
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(THREE_DAYS_SECS));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if let Err(err) = run_ats_scan(&st, None).await {
                            tracing::error!(error = %err, "3-day ATS scan failed");
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
    }
}

/// Runs one Google sync (Gmail + Calendar + linking) and records it in
/// `sync_runs`. Returns 409 `SYNC_IN_PROGRESS` if another sync holds the lock.
pub async fn run_google_sync(state: &AppState) -> Result<SyncRunRecord, AppError> {
    let Ok(_guard) = state.sync_lock.try_lock() else {
        return Err(AppError::ConflictCode(
            "SYNC_IN_PROGRESS",
            "a Google sync is already running".into(),
        ));
    };

    let run_id = new_id();
    sqlx::query(
        "INSERT INTO sync_runs (id, run_type, status, started_at) VALUES (?1, 'gmail_sync', 'running', ?2)",
    )
    .bind(&run_id)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    match state.sync_google_workspace().await {
        Ok((gmail_count, cal_count)) => {
            let meta = serde_json::json!({
                "gmail_threads": gmail_count,
                "calendar_events": cal_count
            })
            .to_string();
            sqlx::query(
                "UPDATE sync_runs SET status = 'succeeded', items_fetched = ?1, meta_json = ?2, finished_at = ?3 WHERE id = ?4",
            )
            .bind(gmail_count + cal_count)
            .bind(meta)
            .bind(now_iso())
            .bind(&run_id)
            .execute(&state.pool)
            .await?;
        }
        Err(err) => {
            sqlx::query(
                "UPDATE sync_runs SET status = 'failed', error_message = ?1, finished_at = ?2 WHERE id = ?3",
            )
            .bind(err.to_string())
            .bind(now_iso())
            .bind(&run_id)
            .execute(&state.pool)
            .await?;
            tracing::warn!(error = %err, "google workspace sync failed");
        }
    }

    let run = sqlx::query_as::<_, SyncRunRecord>(
        r#"
        SELECT id, run_type, status, items_fetched, items_ingested, items_filtered,
               items_errored, meta_json, error_message, started_at, finished_at
        FROM sync_runs WHERE id = ?1
        "#,
    )
    .bind(&run_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(run)
}

/// Hourly hydrogen scoring of pending jobs (skipped when AI is disabled).
pub async fn run_hourly_scoring(state: &AppState) -> Result<(), AppError> {
    if !state.ai.is_enabled() {
        tracing::warn!("AI bridge not configured; skipping hourly tier-1 scoring");
        return Ok(());
    }

    let score_run_id = new_id();
    sqlx::query(
        "INSERT INTO sync_runs (id, run_type, status, started_at) VALUES (?1, 'tier1_score', 'running', ?2)",
    )
    .bind(&score_run_id)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    match state.score_pending_batch(10).await {
        Ok(outcome) => {
            sqlx::query(
                "UPDATE sync_runs SET status = 'succeeded', items_fetched = ?1, items_ingested = ?1, finished_at = ?2 WHERE id = ?3",
            )
            .bind(outcome.scored as i64)
            .bind(now_iso())
            .bind(&score_run_id)
            .execute(&state.pool)
            .await?;
        }
        Err(err) => {
            sqlx::query(
                "UPDATE sync_runs SET status = 'failed', error_message = ?1, finished_at = ?2 WHERE id = ?3",
            )
            .bind(err.to_string())
            .bind(now_iso())
            .bind(&score_run_id)
            .execute(&state.pool)
            .await?;
            return Err(err);
        }
    }

    Ok(())
}

pub async fn run_daily_social_scan(state: &AppState) -> Result<(), AppError> {
    let run_id = new_id();
    sqlx::query(
        "INSERT INTO sync_runs (id, run_type, status, started_at) VALUES (?1, 'social_scan', 'running', ?2)",
    )
    .bind(&run_id)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    let raw_setting = sqlx::query_scalar::<_, String>(
        "SELECT value_json FROM settings WHERE key = 'reddit_feeds'",
    )
    .fetch_optional(&state.pool)
    .await?;

    let feeds: Vec<RedditFeedConfig> = match raw_setting {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => Vec::new(),
    };

    let mut fetched = 0_i64;
    let mut ingested = 0_i64;
    let mut errored = 0_i64;

    for feed in feeds {
        match state.scanner.fetch_reddit_rss(&feed.url, &feed.label).await {
            Ok(jobs) => {
                fetched += jobs.len() as i64;
                let res = state.ingest_scanned_jobs(&jobs, None).await?;
                ingested += res.ingested;
            }
            Err(err) => {
                errored += 1;
                tracing::warn!(feed = %feed.label, error = %err, "reddit rss fetch failed");
            }
        }
    }

    let status = if errored == 0 {
        "succeeded"
    } else if ingested > 0 {
        "partial"
    } else {
        "failed"
    };

    sqlx::query(
        "UPDATE sync_runs SET status = ?1, items_fetched = ?2, items_ingested = ?3, items_errored = ?4, finished_at = ?5 WHERE id = ?6",
    )
    .bind(status)
    .bind(fetched)
    .bind(ingested)
    .bind(errored)
    .bind(now_iso())
    .bind(&run_id)
    .execute(&state.pool)
    .await?;

    Ok(())
}
