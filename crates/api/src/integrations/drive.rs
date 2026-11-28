use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const DRIVE_API_BASE: &str = "https://www.googleapis.com/drive/v3";
pub const DRIVE_UPLOAD_BASE: &str = "https://www.googleapis.com/upload/drive/v3";

#[derive(Debug, Clone)]
pub struct DriveClient {
    http: reqwest::Client,
    api_base: String,
    upload_base: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveFileRecord {
    pub id: String,
    pub name: String,
    #[serde(rename = "webViewLink")]
    pub web_view_link: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(rename = "modifiedTime", default)]
    pub modified_time: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct DriveListResponse {
    #[serde(default)]
    files: Vec<DriveFileRecord>,
}

impl Default for DriveClient {
    fn default() -> Self {
        Self::new()
    }
}

impl DriveClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            api_base: DRIVE_API_BASE.to_string(),
            upload_base: DRIVE_UPLOAD_BASE.to_string(),
        }
    }

    pub fn with_bases(mut self, api_base: String, upload_base: String) -> Self {
        self.api_base = api_base.trim_end_matches('/').to_string();
        self.upload_base = upload_base.trim_end_matches('/').to_string();
        self
    }

    pub async fn list_files_in_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<Vec<DriveFileRecord>, AppError> {
        let url = format!("{}/files", self.api_base);
        let q = format!("'{folder_id}' in parents and trashed = false");
        let resp = self
            .http
            .get(url.as_str())
            .bearer_auth(access_token)
            .query(&[
                ("q", q.as_str()),
                ("fields", "files(id,name,webViewLink,mimeType,modifiedTime)"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("drive list failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "drive list returned {status}: {body}"
            )));
        }

        let parsed: DriveListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid drive list JSON: {e}")))?;
        Ok(parsed.files)
    }

    pub async fn upload_multipart_file(
        &self,
        access_token: &str,
        name: &str,
        mime_type: &str,
        folder_id: Option<&str>,
        bytes: &[u8],
    ) -> Result<DriveFileRecord, AppError> {
        let boundary = "career_os_drive_boundary_7f9a";
        let metadata = match folder_id {
            Some(fid) => serde_json::json!({
                "name": name,
                "mimeType": mime_type,
                "parents": [fid]
            }),
            None => serde_json::json!({
                "name": name,
                "mimeType": mime_type
            }),
        };
        let meta_str =
            serde_json::to_string(&metadata).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

        let mut body = Vec::with_capacity(meta_str.len() + bytes.len() + 256);
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta_str}\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let url = format!("{}/files", self.upload_base);
        let resp = self
            .http
            .post(url.as_str())
            .bearer_auth(access_token)
            .query(&[
                ("uploadType", "multipart"),
                ("fields", "id,name,webViewLink,mimeType"),
            ])
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("drive upload failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "drive upload returned {status}: {err_body}"
            )));
        }

        resp.json::<DriveFileRecord>()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid drive upload JSON: {e}")))
    }

    /// Exports a Google Doc as Markdown (`text/markdown`), falling back to `text/plain`
    /// if the Drive export endpoint rejects `text/markdown`.
    pub async fn export_doc_markdown(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> Result<String, AppError> {
        let url = format!("{}/files/{file_id}/export", self.api_base);
        for mime in ["text/markdown", "text/plain"] {
            let resp = self
                .http
                .get(url.as_str())
                .bearer_auth(access_token)
                .query(&[("mimeType", mime)])
                .send()
                .await
                .map_err(|e| AppError::Upstream(format!("drive export failed: {e}")))?;

            if resp.status().is_success() {
                return resp
                    .text()
                    .await
                    .map_err(|e| AppError::Upstream(format!("drive export read failed: {e}")));
            }
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            if mime == "text/markdown" && status.as_u16() == 400 {
                continue;
            }
            return Err(AppError::Upstream(format!(
                "drive export returned {status}: {err_body}"
            )));
        }
        Err(AppError::Upstream(
            "drive export failed for all text formats".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn uploads_multipart_related_artifact() {
        let app = Router::new().route(
            "/files",
            post(|body: String| async move {
                assert!(body.contains("career_os_drive_boundary_7f9a"));
                assert!(body.contains("Resume - Acme"));
                assert!(body.contains("hello pdf bytes"));
                Json(serde_json::json!({
                    "id": "drv-123",
                    "name": "Resume - Acme",
                    "webViewLink": "https://drive.google.com/file/d/drv-123/view",
                    "mimeType": "application/pdf"
                }))
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client =
            DriveClient::new().with_bases(format!("http://{addr}"), format!("http://{addr}"));
        let record = client
            .upload_multipart_file(
                "tok",
                "Resume - Acme",
                "application/pdf",
                Some("folder-1"),
                b"hello pdf bytes",
            )
            .await
            .unwrap();
        assert_eq!(record.id, "drv-123");
    }

    #[tokio::test]
    async fn lists_folder_with_modified_time_and_exports_markdown_with_fallback() {
        use axum::{extract::Query, http::StatusCode, response::IntoResponse, routing::get};
        use std::collections::HashMap;

        let app = Router::new()
            .route(
                "/files",
                get(|Query(q): Query<HashMap<String, String>>| async move {
                    assert!(q.get("q").unwrap().contains("'folder-xyz' in parents"));
                    assert!(q.get("fields").unwrap().contains("modifiedTime"));
                    Json(serde_json::json!({
                        "files": [{
                            "id": "doc-1",
                            "name": "Project Report A",
                            "webViewLink": "https://docs.google.com/document/d/doc-1/edit",
                            "mimeType": "application/vnd.google-apps.document",
                            "modifiedTime": "2026-11-28T12:00:00Z"
                        }]
                    }))
                }),
            )
            .route(
                "/files/doc-1/export",
                get(|Query(q): Query<HashMap<String, String>>| async move {
                    assert_eq!(q.get("mimeType").map(String::as_str), Some("text/markdown"));
                    "# Report A\n\n- Metric 1".into_response()
                }),
            )
            .route(
                "/files/doc-2/export",
                get(|Query(q): Query<HashMap<String, String>>| async move {
                    match q.get("mimeType").map(String::as_str) {
                        Some("text/markdown") => {
                            (StatusCode::BAD_REQUEST, "unsupported export").into_response()
                        }
                        Some("text/plain") => "Plain text fallback".into_response(),
                        _ => StatusCode::NOT_FOUND.into_response(),
                    }
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client =
            DriveClient::new().with_bases(format!("http://{addr}"), format!("http://{addr}"));
        let files = client
            .list_files_in_folder("tok", "folder-xyz")
            .await
            .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].modified_time.as_deref(),
            Some("2026-11-28T12:00:00Z")
        );

        assert_eq!(
            client.export_doc_markdown("tok", "doc-1").await.unwrap(),
            "# Report A\n\n- Metric 1"
        );
        assert_eq!(
            client.export_doc_markdown("tok", "doc-2").await.unwrap(),
            "Plain text fallback"
        );
    }
}
