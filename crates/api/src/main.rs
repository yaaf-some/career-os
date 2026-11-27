use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use tokio::{net::TcpListener, sync::watch};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use career_os_api::{
    ai::select_ai_provider,
    build_router,
    config::AppConfig,
    crypto::TokenCipher,
    db::init_pool,
    integrations::{
        calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, linear::LinearClient,
        maps::MapsClient, scanner::ScannerClient,
    },
    openapi::export_openapi_to_file,
    scheduler::spawn_scheduler,
    state::AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().skip(1).any(|a| a == "--healthcheck") {
        std::process::exit(if healthcheck() { 0 } else { 1 });
    }

    if let Some(export_path) = parse_export_openapi_arg() {
        export_openapi_to_file(&export_path)?;
        return Ok(());
    }

    init_tracing();
    let config = Arc::new(AppConfig::from_env());

    let pool = init_pool(&config.database_url).await?;
    let cipher = match &config.token_encryption_key {
        Some(raw) => Some(
            TokenCipher::from_encoded_key(raw)
                .map_err(|e| anyhow::anyhow!("TOKEN_ENCRYPTION_KEY (or CAREER_OS_TOKEN_KEY) invalid: {e}; generate one with `openssl rand -base64 32`, or leave it unset to disable Google OAuth"))?,
        ),
        None => None,
    };

    let ai = select_ai_provider(
        config.ai_bridge_url.as_deref(),
        config.ai_bridge_token.as_deref(),
        config.ai_demo_mode,
    );

    let state = AppState {
        pool,
        config: Arc::clone(&config),
        ai,
        cipher,
        scanner: ScannerClient::new(),
        gmail: GmailClient::new(),
        drive: DriveClient::new(),
        calendar: CalendarClient::new(),
        maps: MapsClient::new(config.google_maps_api_key.clone()),
        sync_lock: Default::default(),
        linear: match (&config.linear_api_key, &config.linear_team_id) {
            (Some(key), Some(_)) => Some(LinearClient::new(key.clone())),
            _ => None,
        },
    };

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    spawn_scheduler(state.clone(), shutdown_rx);

    let app = build_router(state);
    let listener = TcpListener::bind(&config.bind_addr).await?;
    tracing::info!(bind = %config.bind_addr, "career-os-api listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(shutdown_tx))
    .await?;

    Ok(())
}

fn parse_export_openapi_arg() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--export-openapi" {
            return args.next().map(PathBuf::from);
        }
        if let Some(path) = arg.strip_prefix("--export-openapi=") {
            return Some(PathBuf::from(path));
        }
    }
    None
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));

    let use_json = std::env::var("CAREER_OS_LOG_FORMAT")
        .map(|v| v.eq_ignore_ascii_case("json"))
        .unwrap_or(false);

    if use_json {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }
}

/// Container liveness probe for shell-less (distroless) images: `career-os-api --healthcheck`
/// issues `GET /healthz` against the configured bind port on loopback and exits 0 on HTTP 200.
fn healthcheck() -> bool {
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
    use std::time::Duration;

    let bind = std::env::var("CAREER_OS_BIND").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    let port = bind
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse::<u16>().ok())
        .unwrap_or(3000);
    let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into();
    let timeout = Duration::from_secs(2);

    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 32];
    match stream.read(&mut buf) {
        Ok(n) => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        Err(_) => false,
    }
}

/// Resolve on SIGINT (Ctrl-C) or SIGTERM (`docker stop`). As container PID 1 the process
/// ignores SIGTERM unless it installs a handler, which would force a SIGKILL after the
/// stop timeout and skip the graceful SQLite/scheduler shutdown.
async fn shutdown_signal(shutdown_tx: watch::Sender<bool>) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
    let _ = shutdown_tx.send(true);
}
