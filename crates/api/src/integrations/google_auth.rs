use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use crate::{
    crypto::TokenCipher,
    db::{new_id, now_iso},
    error::AppError,
};

pub const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const GOOGLE_PROVIDER_NAME: &str = "google";

pub const DEFAULT_GOOGLE_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GoogleTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct OAuthTokenRow {
    pub id: String,
    pub provider: String,
    pub account_email: Option<String>,
    pub access_token_enc: String,
    pub refresh_token_enc: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct GoogleOAuthClient {
    http: reqwest::Client,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    auth_endpoint: String,
    token_endpoint: String,
}

impl GoogleOAuthClient {
    pub fn new(client_id: String, client_secret: String, redirect_uri: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            client_id,
            client_secret,
            redirect_uri,
            auth_endpoint: GOOGLE_AUTH_ENDPOINT.to_string(),
            token_endpoint: GOOGLE_TOKEN_ENDPOINT.to_string(),
        }
    }

    pub fn with_endpoints(mut self, auth_endpoint: String, token_endpoint: String) -> Self {
        self.auth_endpoint = auth_endpoint;
        self.token_endpoint = token_endpoint;
        self
    }

    pub fn build_authorization_url(&self, state: &str, scopes: &[&str]) -> Result<String, AppError> {
        let scope_str = if scopes.is_empty() {
            DEFAULT_GOOGLE_SCOPES.join(" ")
        } else {
            scopes.join(" ")
        };

        let url = reqwest::Url::parse_with_params(
            &self.auth_endpoint,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("response_type", "code"),
                ("scope", scope_str.as_str()),
                ("access_type", "offline"),
                ("prompt", "consent"),
                ("state", state),
            ],
        )
        .map_err(|e| AppError::Config(format!("invalid google auth URL: {e}")))?;

        Ok(url.to_string())
    }

    pub async fn exchange_code(&self, code: &str) -> Result<GoogleTokenResponse, AppError> {
        let resp = self
            .http
            .post(self.token_endpoint.as_str())
            .form(&[
                ("code", code),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("google token exchange failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "google token endpoint returned {status}: {body}"
            )));
        }

        resp.json::<GoogleTokenResponse>()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid google token JSON: {e}")))
    }

    pub async fn refresh_token(&self, refresh_token: &str) -> Result<GoogleTokenResponse, AppError> {
        let resp = self
            .http
            .post(self.token_endpoint.as_str())
            .form(&[
                ("refresh_token", refresh_token),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("google token refresh failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "google refresh endpoint returned {status}: {body}"
            )));
        }

        resp.json::<GoogleTokenResponse>()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid google refresh JSON: {e}")))
    }
}

pub async fn store_google_tokens(
    pool: &SqlitePool,
    cipher: &TokenCipher,
    account_email: Option<&str>,
    tokens: &GoogleTokenResponse,
) -> Result<(), AppError> {
    let access_enc = cipher
        .encrypt(&tokens.access_token)
        .map_err(|e| AppError::Config(format!("failed to encrypt access token: {e}")))?;
    let refresh_enc = match &tokens.refresh_token {
        Some(rt) if !rt.is_empty() => Some(
            cipher
                .encrypt(rt)
                .map_err(|e| AppError::Config(format!("failed to encrypt refresh token: {e}")))?,
        ),
        _ => None,
    };

    let expires_at = tokens.expires_in.map(|secs| {
        (Utc::now() + Duration::seconds(secs)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    });
    let now = now_iso();
    let id = new_id();

    sqlx::query(
        r#"
        INSERT INTO oauth_tokens (
            id, provider, account_email, access_token_enc, refresh_token_enc,
            token_type, scope, expires_at, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
        ON CONFLICT(provider) DO UPDATE SET
            account_email = COALESCE(excluded.account_email, oauth_tokens.account_email),
            access_token_enc = excluded.access_token_enc,
            refresh_token_enc = COALESCE(excluded.refresh_token_enc, oauth_tokens.refresh_token_enc),
            token_type = COALESCE(excluded.token_type, oauth_tokens.token_type),
            scope = COALESCE(excluded.scope, oauth_tokens.scope),
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(id)
    .bind(GOOGLE_PROVIDER_NAME)
    .bind(account_email)
    .bind(access_enc)
    .bind(refresh_enc)
    .bind(&tokens.token_type)
    .bind(&tokens.scope)
    .bind(expires_at)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn load_google_token_row(pool: &SqlitePool) -> Result<Option<OAuthTokenRow>, AppError> {
    let row = sqlx::query_as::<_, OAuthTokenRow>(
        "SELECT id, provider, account_email, access_token_enc, refresh_token_enc, token_type, scope, expires_at, created_at, updated_at FROM oauth_tokens WHERE provider = ?1",
    )
    .bind(GOOGLE_PROVIDER_NAME)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn get_valid_google_access_token(
    pool: &SqlitePool,
    cipher: &TokenCipher,
    oauth_client: Option<&GoogleOAuthClient>,
) -> Result<Option<String>, AppError> {
    let Some(row) = load_google_token_row(pool).await? else {
        return Ok(None);
    };

    let needs_refresh = row
        .expires_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc) <= Utc::now() + Duration::seconds(60))
        .unwrap_or(false);

    if needs_refresh {
        if let (Some(client), Some(refresh_enc)) = (oauth_client, row.refresh_token_enc.as_deref()) {
            let refresh_tok = cipher
                .decrypt(refresh_enc)
                .map_err(|e| AppError::Config(format!("failed to decrypt refresh token: {e}")))?;
            let refreshed = client.refresh_token(&refresh_tok).await?;
            let access = refreshed.access_token.clone();
            store_google_tokens(pool, cipher, row.account_email.as_deref(), &refreshed).await?;
            return Ok(Some(access));
        }
    }

    let access = cipher
        .decrypt(&row.access_token_enc)
        .map_err(|e| AppError::Config(format!("failed to decrypt access token: {e}")))?;
    Ok(Some(access))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;
    use axum::{routing::post, Json, Router};
    use tokio::net::TcpListener;

    #[test]
    fn authorization_url_contains_expected_params() {
        let client = GoogleOAuthClient::new(
            "demo-client-id".to_string(),
            "demo-secret".to_string(),
            "http://127.0.0.1:3000/api/auth/google/callback".to_string(),
        );
        let url = client
            .build_authorization_url("csrf-state-123", DEFAULT_GOOGLE_SCOPES)
            .expect("build url");
        assert!(url.contains("client_id=demo-client-id"));
        assert!(url.contains("state=csrf-state-123"));
        assert!(url.contains("access_type=offline"));
    }

    #[tokio::test]
    async fn exchange_code_and_store_encrypted_tokens() {
        let app = Router::new().route(
            "/token",
            post(|| async {
                Json(serde_json::json!({
                    "access_token": "ya29.test-access",
                    "refresh_token": "1//test-refresh",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                    "scope": "email"
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = GoogleOAuthClient::new(
            "cid".to_string(),
            "csec".to_string(),
            "http://127.0.0.1:3000/api/auth/google/callback".to_string(),
        )
        .with_endpoints(
            format!("http://{addr}/auth"),
            format!("http://{addr}/token"),
        );

        let tokens = client.exchange_code("auth-code-xyz").await.unwrap();
        assert_eq!(tokens.access_token, "ya29.test-access");

        let pool = init_pool("sqlite::memory:").await.unwrap();
        let cipher = TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        store_google_tokens(&pool, &cipher, None, &tokens)
            .await
            .unwrap();

        let stored = load_google_token_row(&pool).await.unwrap().unwrap();
        assert_ne!(stored.access_token_enc, "ya29.test-access");
        assert!(stored.access_token_enc.starts_with("v1:"));

        let decrypted = get_valid_google_access_token(&pool, &cipher, Some(&client))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(decrypted, "ya29.test-access");
    }
}
