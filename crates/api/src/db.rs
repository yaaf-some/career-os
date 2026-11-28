use std::{path::Path, str::FromStr, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};

/// Writes a consistent snapshot of the live database to `dest` with
/// `VACUUM INTO` (safe while the app is writing; WAL is folded in). `dest` must
/// not exist. Used by `career-os-api --backup-stdout` (JOB-7 nightly backups).
pub async fn backup_into(database_url: &str, dest: &Path) -> anyhow::Result<()> {
    use sqlx::ConnectOptions;
    let mut conn = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(10))
        .connect()
        .await?;
    sqlx::query("VACUUM INTO ?1")
        .bind(dest.to_string_lossy().as_ref())
        .execute(&mut conn)
        .await?;
    Ok(())
}

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

#[cfg(test)]
mod backup_tests {
    use super::*;

    #[tokio::test]
    async fn backup_snapshot_contains_committed_rows() {
        let dir =
            std::env::temp_dir().join(format!("career-os-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("live.db");
        let out = dir.join("snap.db");
        let _ = std::fs::remove_file(&out);
        let url = format!("sqlite://{}?mode=rwc", db.display());
        let pool = init_pool(&url).await.unwrap();
        sqlx::query("INSERT INTO jobs (id, canonical_key, url, company, title, source_type) VALUES ('j1','k1','https://x.example/1','Example Co','Eng','manual')")
            .execute(&pool)
            .await
            .unwrap();

        backup_into(&url, &out).await.unwrap();
        let snap = init_pool(&format!("sqlite://{}", out.display()))
            .await
            .unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs")
            .fetch_one(&snap)
            .await
            .unwrap();
        assert_eq!(n, 1);
        let ok: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&snap)
            .await
            .unwrap();
        assert_eq!(ok, "ok");
        // Refuses to overwrite an existing file.
        assert!(backup_into(&url, &out).await.is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
