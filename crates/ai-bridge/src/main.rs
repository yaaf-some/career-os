use std::sync::Arc;

use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use career_os_ai_bridge::{
    build_bridge_app,
    config::BridgeConfig,
    runner::{BridgeRouter, SystemCliRunner},
    BridgeState,
};

/// Must stay below the plist's `ExitTimeOut`.
const SHUTDOWN_DRAIN: std::time::Duration = std::time::Duration::from_secs(20);

async fn shutdown_signal() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout())),
        )
        .init();

    let config = match BridgeConfig::from_env() {
        Ok(config) => config,
        Err(e) => {
            tracing::error!(error = %e, "invalid ai-bridge configuration");
            return Err(anyhow::anyhow!(e));
        }
    };

    career_os_ai_bridge::cli::prepare_workdir(&config.workdir).map_err(|e| {
        tracing::error!(error = %e, workdir = %config.workdir.display(), "cannot prepare ai-bridge workdir");
        anyhow::anyhow!("cannot prepare workdir {}: {e}", config.workdir.display())
    })?;

    let bind_addr = config.bind_addr.clone();
    let runner = Arc::new(SystemCliRunner::from_config(&config));
    let state = BridgeState {
        router: Arc::new(BridgeRouter::new(config, runner)),
    };

    let app = build_bridge_app(state);
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!(bind = %bind_addr, "career-os-ai-bridge listening");

    // launchd stops jobs with SIGTERM (then SIGKILL after ExitTimeOut). Drain briefly,
    // then return so the runtime drops in-flight runs and `kill_on_drop` reaps the CLIs
    // instead of leaving them orphaned.
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = stop_rx.changed().await;
    });
    tokio::select! {
        res = server => res?,
        _ = async {
            shutdown_signal().await;
            tracing::info!("career-os-ai-bridge shutting down");
            let _ = stop_tx.send(true);
            tokio::time::sleep(SHUTDOWN_DRAIN).await;
        } => tracing::warn!("drain timed out; aborting in-flight CLI runs"),
    }

    Ok(())
}
