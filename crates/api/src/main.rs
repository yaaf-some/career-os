use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use tokio::{net::TcpListener, sync::watch};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use career_os_api::{
    ai::{AiProvider, HostBridgeProvider, MockAiProvider},
    build_router,
    config::AppConfig,
    crypto::TokenCipher,
    db::init_pool,
    integrations::{
        calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, scanner::ScannerClient,
    },
    openapi::export_openapi_to_file,
    scheduler::spawn_scheduler,
    state::AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
                .map_err(|e| anyhow::anyhow!("CAREER_OS_TOKEN_KEY invalid: {e}"))?,
        ),
        None => None,
    };

    let ai: Arc<dyn AiProvider> = match (&config.ai_bridge_url, config.ai_demo_mode) {
        (Some(url), false) => Arc::new(HostBridgeProvider::new(
            url.clone(),
            config.ai_bridge_token.clone().unwrap_or_default(),
        )),
        _ => {
            tracing::info!("using MockAiProvider (AI_BRIDGE_URL unset or AI_DEMO_MODE=true)");
            Arc::new(MockAiProvider)
        }
    };

    let state = AppState {
        pool,
        config: Arc::clone(&config),
        ai,
        cipher,
        scanner: ScannerClient::new(),
        gmail: GmailClient::new(),
        drive: DriveClient::new(),
        calendar: CalendarClient::new(),
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

async fn shutdown_signal(shutdown_tx: watch::Sender<bool>) {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
    let _ = shutdown_tx.send(true);
}
