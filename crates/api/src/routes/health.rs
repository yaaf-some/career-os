use axum::{extract::State, Json};
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub db_ok: bool,
}

#[utoipa::path(
    get,
    path = "/healthz",
    responses(
        (status = 200, description = "Service health check", body = HealthResponse)
    ),
    tag = "health"
)]
pub async fn healthz(State(state): State<AppState>) -> Json<HealthResponse> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .is_ok();

    Json(HealthResponse {
        status: if db_ok { "ok" } else { "degraded" }.to_string(),
        service: "career-os-api".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        db_ok,
    })
}
