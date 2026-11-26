use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

#[derive(Debug, Clone)]
pub struct CalendarClient {
    http: reqwest::Client,
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEventTime {
    #[serde(rename = "dateTime")]
    pub date_time: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEventDto {
    pub id: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "htmlLink")]
    pub html_link: Option<String>,
    pub start: CalendarEventTime,
    pub end: CalendarEventTime,
}

#[derive(Debug, Clone, Deserialize)]
struct CalendarListResponse {
    #[serde(default)]
    items: Vec<CalendarEventDto>,
}

impl Default for CalendarClient {
    fn default() -> Self {
        Self::new()
    }
}

impl CalendarClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: CALENDAR_API_BASE.to_string(),
        }
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }

    pub async fn list_upcoming_events(
        &self,
        access_token: &str,
        time_min_rfc3339: &str,
        max_results: u32,
    ) -> Result<Vec<CalendarEventDto>, AppError> {
        let url = format!("{}/calendars/primary/events", self.base_url);
        let max_str = max_results.to_string();
        let resp = self
            .http
            .get(url.as_str())
            .bearer_auth(access_token)
            .query(&[
                ("timeMin", time_min_rfc3339),
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("maxResults", max_str.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("calendar list failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "calendar list returned {status}: {body}"
            )));
        }

        let parsed: CalendarListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid calendar list JSON: {e}")))?;
        Ok(parsed.items)
    }

    pub async fn create_event(
        &self,
        access_token: &str,
        summary: &str,
        description: Option<&str>,
        starts_at_rfc3339: &str,
        ends_at_rfc3339: &str,
    ) -> Result<CalendarEventDto, AppError> {
        let url = format!("{}/calendars/primary/events", self.base_url);
        let payload = serde_json::json!({
            "summary": summary,
            "description": description,
            "start": { "dateTime": starts_at_rfc3339 },
            "end": { "dateTime": ends_at_rfc3339 }
        });

        let resp = self
            .http
            .post(url.as_str())
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("calendar create failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "calendar create returned {status}: {body}"
            )));
        }

        resp.json::<CalendarEventDto>()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid calendar create JSON: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn lists_upcoming_calendar_events() {
        let app = Router::new().route(
            "/calendars/primary/events",
            get(|| async {
                Json(serde_json::json!({
                    "items": [{
                        "id": "evt-1",
                        "summary": "Tech Screen - Acme",
                        "htmlLink": "https://calendar.google.com/event?eid=1",
                        "start": { "dateTime": "2026-12-01T15:00:00Z" },
                        "end": { "dateTime": "2026-12-01T15:45:00Z" }
                    }]
                }))
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = CalendarClient::new().with_base_url(format!("http://{addr}"));
        let events = client
            .list_upcoming_events("tok", "2026-11-26T00:00:00Z", 20)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary.as_deref(), Some("Tech Screen - Acme"));
    }
}
