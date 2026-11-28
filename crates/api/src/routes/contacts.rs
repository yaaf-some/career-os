//! Contacts, per-job activity and thread discovery (unit 3).
//! Add routes to `router()` and list their handlers in `Doc`.

use crate::state::AppState;

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
}

#[derive(utoipa::OpenApi)]
#[openapi()]
pub struct Doc;
