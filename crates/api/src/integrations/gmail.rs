use serde::{Deserialize, Serialize};

use base64::{
    engine::general_purpose::{STANDARD as B64, URL_SAFE as B64_URL},
    Engine as _,
};

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

    /// Creates a Gmail **draft** (never sends). Returns the draft id.
    pub async fn create_draft(
        &self,
        access_token: &str,
        draft: &DraftMessage<'_>,
    ) -> Result<String, AppError> {
        let url = format!("{}/users/me/drafts", self.base_url);
        let resp = self
            .http
            .post(url.as_str())
            .bearer_auth(access_token)
            .json(&draft_body(draft))
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("gmail draft create failed: {e}")))?;
        parse_draft_response(resp).await
    }

    /// Replaces an existing Gmail draft's content (never sends). If the draft no
    /// longer exists (deleted or sent by the user in Gmail), creates a new one.
    pub async fn update_draft(
        &self,
        access_token: &str,
        draft_id: &str,
        draft: &DraftMessage<'_>,
    ) -> Result<String, AppError> {
        let url = format!("{}/users/me/drafts/{}", self.base_url, draft_id);
        let resp = self
            .http
            .put(url.as_str())
            .bearer_auth(access_token)
            .json(&draft_body(draft))
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("gmail draft update failed: {e}")))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return self.create_draft(access_token, draft).await;
        }
        parse_draft_response(resp).await
    }
}

/// Plain-text email for a Gmail draft. Header fields are sanitized (no CR/LF).
#[derive(Debug, Clone)]
pub struct DraftMessage<'a> {
    pub to: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
}

fn header_value(v: &str) -> String {
    v.chars()
        .filter(|c| *c != '\r' && *c != '\n')
        .collect::<String>()
        .trim()
        .to_string()
}

/// RFC 2047 encoded-word for non-ASCII subjects.
fn encode_subject(subject: &str) -> String {
    let clean = header_value(subject);
    if clean.is_ascii() {
        clean
    } else {
        format!("=?UTF-8?B?{}?=", B64.encode(clean.as_bytes()))
    }
}

/// RFC 2822 message, base64url-encoded as Gmail's `raw` field expects.
pub fn build_raw_message(draft: &DraftMessage<'_>) -> String {
    let body = draft.body.replace("\r\n", "\n").replace('\n', "\r\n");
    let msg = format!(
        "To: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",
        header_value(draft.to),
        encode_subject(draft.subject),
        B64.encode(body.as_bytes()),
    );
    B64_URL.encode(msg.as_bytes())
}

fn draft_body(draft: &DraftMessage<'_>) -> serde_json::Value {
    serde_json::json!({ "message": { "raw": build_raw_message(draft) } })
}

async fn parse_draft_response(resp: reqwest::Response) -> Result<String, AppError> {
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::ConflictCode(
            "GOOGLE_RECONNECT_REQUIRED",
            "Google needs to be reconnected to allow Gmail drafts".into(),
        ));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Upstream(format!(
            "gmail drafts returned {status}: {body}"
        )));
    }
    #[derive(Deserialize)]
    struct DraftResp {
        id: String,
    }
    let parsed: DraftResp = resp
        .json()
        .await
        .map_err(|e| AppError::Upstream(format!("invalid gmail draft JSON: {e}")))?;
    Ok(parsed.id)
}

/// Gmail auto-categories that never hold a recruiter reply. `CATEGORY_UPDATES`
/// stays eligible: real replies from ATS-hosted recruiters often land there.
const AUTOMATED_CATEGORIES: &[&str] =
    &["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];

/// Mailbox local-parts that are machine senders (`no-reply@`, `notifications@`, …).
const AUTOMATED_LOCAL_PARTS: &[&str] = &[
    "noreply",
    "donotreply",
    "notification",
    "notifications",
    "mailerdaemon",
    "postmaster",
];

/// True when a thread's last message is automated mail that needs no reply.
fn is_automated(from: Option<&str>, labels: &[String]) -> bool {
    if labels
        .iter()
        .any(|l| AUTOMATED_CATEGORIES.contains(&l.as_str()))
    {
        return true;
    }
    let Some(from) = from else { return false };
    // `Name <addr@host>` or a bare `addr@host`.
    let addr = from
        .rsplit_once('<')
        .map(|(_, rest)| rest.trim_end_matches('>'))
        .unwrap_or(from);
    let Some((local, _)) = addr.trim().split_once('@') else {
        return false;
    };
    let local: String = local
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    AUTOMATED_LOCAL_PARTS.contains(&local.as_str())
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
    let needs_reply = labels.iter().any(|l| l == "INBOX")
        && !labels.iter().any(|l| l == "SENT")
        && !is_automated(from_email.as_deref(), &labels);

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

    fn labels(ls: &[&str]) -> Vec<String> {
        ls.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn automated_senders_and_categories_need_no_reply() {
        let inbox = labels(&["INBOX"]);
        for from in [
            "no-reply@ats.example",
            "Acme Careers <noreply@acme.example>",
            "do-not-reply@acme.example",
            "notifications@board.example",
            "MAILER-DAEMON@mx.example",
        ] {
            assert!(is_automated(Some(from), &inbox), "{from}");
        }
        assert!(is_automated(
            Some("pat@acme.example"),
            &labels(&["INBOX", "CATEGORY_PROMOTIONS"])
        ));
        assert!(is_automated(None, &labels(&["CATEGORY_SOCIAL"])));
    }

    #[test]
    fn human_reply_in_updates_still_needs_reply() {
        assert!(!is_automated(
            Some("Pat Recruiter <pat@acme.example>"),
            &labels(&["INBOX", "CATEGORY_UPDATES"])
        ));
        assert!(!is_automated(Some("not-an-address"), &labels(&["INBOX"])));
        assert!(!is_automated(None, &labels(&["INBOX"])));
    }

    #[test]
    fn raw_message_strips_header_injection_and_encodes_utf8() {
        let raw = build_raw_message(&DraftMessage {
            to: "a@example.com\r\nBcc: evil@example.com",
            subject: "Café chat\nBcc: x@example.com",
            body: "Hi,\nThanks!",
        });
        let decoded = String::from_utf8(B64_URL.decode(raw).unwrap()).unwrap();
        let (headers, body) = decoded.split_once("\r\n\r\n").unwrap();
        assert!(headers.starts_with("To: a@example.comBcc: evil@example.com\r\n"));
        assert_eq!(headers.lines().filter(|l| l.starts_with("Bcc")).count(), 0);
        assert!(headers.contains("Subject: =?UTF-8?B?"));
        assert_eq!(
            String::from_utf8(B64.decode(body).unwrap()).unwrap(),
            "Hi,\r\nThanks!"
        );
    }

    #[tokio::test]
    async fn drafts_are_created_and_updated_never_sent() {
        use axum::{extract::Request, http::StatusCode, response::IntoResponse};
        use std::sync::{Arc, Mutex};

        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let log = seen.clone();
        let app = Router::new().fallback(move |req: Request| {
            let log = log.clone();
            async move {
                let line = format!("{} {}", req.method(), req.uri().path());
                log.lock().unwrap().push(line.clone());
                match line.as_str() {
                    "POST /users/me/drafts" => {
                        Json(serde_json::json!({"id": "d-new"})).into_response()
                    }
                    "PUT /users/me/drafts/d-1" => {
                        Json(serde_json::json!({"id": "d-1"})).into_response()
                    }
                    "PUT /users/me/drafts/revoked" => StatusCode::FORBIDDEN.into_response(),
                    _ => StatusCode::NOT_FOUND.into_response(),
                }
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = GmailClient::new().with_base_url(format!("http://{addr}"));
        let msg = DraftMessage {
            to: "r@example.com",
            subject: "Hi",
            body: "Thanks",
        };
        assert_eq!(client.create_draft("tok", &msg).await.unwrap(), "d-new");
        assert_eq!(
            client.update_draft("tok", "d-1", &msg).await.unwrap(),
            "d-1"
        );
        // Draft deleted in Gmail: recreate instead of failing.
        assert_eq!(
            client.update_draft("tok", "gone", &msg).await.unwrap(),
            "d-new"
        );
        let err = client
            .update_draft("tok", "revoked", &msg)
            .await
            .unwrap_err();
        assert_eq!(err.status_and_code().1, "GOOGLE_RECONNECT_REQUIRED");

        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 5);
        assert!(
            seen.iter().all(|l| !l.contains("send")),
            "never send: {seen:?}"
        );
    }
}
