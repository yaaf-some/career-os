use std::sync::Arc;

use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use career_os_ai_bridge::{
    build_bridge_app,
    config::BridgeConfig,
    runner::{BridgeRouter, SystemCliRunner},
    BridgeState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = BridgeConfig::from_env();
    if config.bearer_token.is_none() {
        tracing::warn!("AI_BRIDGE_TOKEN is unset; all authenticated endpoints will fail closed with 401");
    }

    let bind_addr = config.bind_addr.clone();
    let runner = Arc::new(SystemCliRunner::from_config(&config));
    let state = BridgeState {
        router: Arc::new(BridgeRouter::new(config, runner)),
    };

    let app = build_bridge_app(state);
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!(bind = %bind_addr, "career-os-ai-bridge listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("career-os-ai-bridge shutting down");
        })
        .await?;

    Ok(())
}
