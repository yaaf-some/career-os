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
                ("fields", "files(id,name,webViewLink,mimeType)"),
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
}
