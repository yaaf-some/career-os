use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: {0}")]
    Conflict(String),

    /// 409 with a specific machine-readable code (e.g. `GOOGLE_NOT_CONNECTED`).
    #[error("{1}")]
    ConflictCode(&'static str, String),

    #[error("upstream service error: {0}")]
    Upstream(String),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("rate limited: {0}")]
    RateLimited(String),

    #[error("upstream timed out: {0}")]
    GatewayTimeout(String),

    #[error("configuration error: {0}")]
    Config(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST"),
            Self::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED"),
            Self::Forbidden(_) => (StatusCode::FORBIDDEN, "FORBIDDEN"),
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT"),
            Self::ConflictCode(code, _) => (StatusCode::CONFLICT, code),
            Self::Upstream(_) => (StatusCode::BAD_GATEWAY, "UPSTREAM_ERROR"),
            Self::ServiceUnavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE"),
            Self::RateLimited(_) => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED"),
            Self::GatewayTimeout(_) => (StatusCode::GATEWAY_TIMEOUT, "GATEWAY_TIMEOUT"),
            Self::Config(_) => (StatusCode::INTERNAL_SERVER_ERROR, "CONFIG_ERROR"),
            Self::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
            Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        let message = match &self {
            Self::Database(err) => {
                tracing::error!(error = %err, "database error");
                "Database operation failed".to_string()
            }
            Self::Internal(err) => {
                tracing::error!(error = %err, "internal error");
                "Internal server error".to_string()
            }
            other => other.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                error: message,
                code: code.to_string(),
            }),
        )
            .into_response()
    }
}
