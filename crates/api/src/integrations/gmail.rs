use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const GMAIL_API_BASE: &str = "https://gmail.googleapis.com/gmail/v1";

#[derive(Debug, Clone)]
pub struct GmailClient {
    http: reqwest::Client,
    base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailThreadsListResponse {
    #[serde(default)]
    threads: Vec<GmailThreadRef>,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailThreadRef {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailThreadApiResponse {
    id: String,
    #[serde(default)]
    messages: Vec<GmailMessage>,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailMessage {
    snippet: Option<String>,
    #[serde(rename = "labelIds", default)]
    label_ids: Vec<String>,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    payload: Option<GmailPayload>,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailPayload {
    #[serde(default)]
    headers: Vec<GmailHeader>,
}

#[derive(Debug, Clone, Deserialize)]
struct GmailHeader {
    name: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedGmailThread {
    pub thread_id: String,
    pub subject: Option<String>,
    pub from_email: Option<String>,
    pub labels: Vec<String>,
    pub snippet: Option<String>,
    pub needs_reply: bool,
    pub last_message_at: Option<String>,
}

impl Default for GmailClient {
    fn default() -> Self {
        Self::new()
    }
}

impl GmailClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: GMAIL_API_BASE.to_string(),
        }
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }

    pub async fn list_and_fetch_threads(
        &self,
        access_token: &str,
        query: &str,
        max_results: u32,
    ) -> Result<Vec<SyncedGmailThread>, AppError> {
        let list_url = format!("{}/users/me/threads", self.base_url);
        let max_str = max_results.to_string();
        let resp = self
            .http
            .get(list_url.as_str())
            .bearer_auth(access_token)
            .query(&[("q", query), ("maxResults", max_str.as_str())])
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("gmail threads list failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "gmail list returned {status}: {body}"
            )));
        }

        let listed: GmailThreadsListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid gmail list JSON: {e}")))?;

        let mut results = Vec::with_capacity(listed.threads.len());
        for tref in listed.threads {
            let thread_url = format!("{}/users/me/threads/{}", self.base_url, tref.id);
            let t_resp = self
                .http
                .get(thread_url.as_str())
                .bearer_auth(access_token)
                .query(&[
                    ("format", "metadata"),
                    ("metadataHeaders", "Subject"),
                    ("metadataHeaders", "From"),
                ])
                .send()
                .await
                .map_err(|e| AppError::Upstream(format!("gmail thread fetch failed: {e}")))?;

            if !t_resp.status().is_success() {
                continue;
            }
            let raw: GmailThreadApiResponse = t_resp
                .json()
                .await
                .map_err(|e| AppError::Upstream(format!("invalid gmail thread JSON: {e}")))?;
            results.push(normalize_thread(raw));
        }

        Ok(results)
    }
}

fn normalize_thread(raw: GmailThreadApiResponse) -> SyncedGmailThread {
    let last_msg = raw.messages.last();
    let mut subject = None;
    let mut from_email = None;

    if let Some(headers) = last_msg
        .and_then(|m| m.payload.as_ref())
        .map(|p| &p.headers)
    {
        for h in headers {
            if h.name.eq_ignore_ascii_case("Subject") {
                subject = Some(h.value.clone());
            } else if h.name.eq_ignore_ascii_case("From") {
                from_email = Some(h.value.clone());
            }
        }
    }

    let labels = last_msg.map(|m| m.label_ids.clone()).unwrap_or_default();
    let needs_reply = labels.iter().any(|l| l == "INBOX") && !labels.iter().any(|l| l == "SENT");

    let last_message_at = last_msg
        .and_then(|m| m.internal_date.as_deref())
        .and_then(|ms| ms.parse::<i64>().ok())
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));

    SyncedGmailThread {
        thread_id: raw.id,
        subject,
        from_email,
        labels,
        snippet: last_msg.and_then(|m| m.snippet.clone()),
        needs_reply,
        last_message_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn fetches_and_normalizes_gmail_threads() {
        let app = Router::new()
            .route(
                "/users/me/threads",
                get(|| async {
                    Json(serde_json::json!({
                        "threads": [{ "id": "thr-1" }]
                    }))
                }),
            )
            .route(
                "/users/me/threads/thr-1",
                get(|| async {
                    Json(serde_json::json!({
                        "id": "thr-1",
                        "messages": [{
                            "snippet": "Would you be available for an intro call?",
                            "labelIds": ["INBOX", "UNREAD"],
                            "internalDate": "1730000000000",
                            "payload": {
                                "headers": [
                                    { "name": "Subject", "value": "Interview Invitation - Acme" },
                                    { "name": "From", "value": "recruiting@acme.example" }
                                ]
                            }
                        }]
                    }))
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = GmailClient::new().with_base_url(format!("http://{addr}"));
        let threads = client
            .list_and_fetch_threads("tok", "interview", 10)
            .await
            .unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].thread_id, "thr-1");
        assert!(threads[0].needs_reply);
        assert_eq!(
            threads[0].subject.as_deref(),
            Some("Interview Invitation - Acme")
        );
    }
}
