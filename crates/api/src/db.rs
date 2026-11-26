use std::{path::Path, str::FromStr, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};

pub async fn init_pool(database_url: &str) -> anyhow::Result<SqlitePool> {
    ensure_parent_dir(database_url)?;

    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let max_conns = if database_url.contains(":memory:") {
        1
    } else {
        5
    };

    let pool = SqlitePoolOptions::new()
        .max_connections(max_conns)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

fn ensure_parent_dir(database_url: &str) -> anyhow::Result<()> {
    if database_url.contains(":memory:") {
        return Ok(());
    }
    let raw_path = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))
        .unwrap_or(database_url);
    let path_without_query = raw_path.split('?').next().unwrap_or(raw_path);
    if path_without_query.is_empty() {
        return Ok(());
    }
    if let Some(parent) = Path::new(path_without_query).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
