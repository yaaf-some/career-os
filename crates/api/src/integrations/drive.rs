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
        self.upload_multipart_with_types(access_token, name, mime_type, mime_type, folder_id, bytes)
            .await
    }

    /// Creates a native editable Google Doc in Drive by uploading HTML converted to
    /// `application/vnd.google-apps.document` using the existing `drive.file` scope.
    pub async fn create_google_doc_from_html(
        &self,
        access_token: &str,
        name: &str,
        folder_id: Option<&str>,
        html: &str,
    ) -> Result<DriveFileRecord, AppError> {
        self.upload_multipart_with_types(
            access_token,
            name,
            "application/vnd.google-apps.document",
            "text/html; charset=UTF-8",
            folder_id,
            html.as_bytes(),
        )
        .await
    }

    async fn upload_multipart_with_types(
        &self,
        access_token: &str,
        name: &str,
        target_mime_type: &str,
        content_mime_type: &str,
        folder_id: Option<&str>,
        bytes: &[u8],
    ) -> Result<DriveFileRecord, AppError> {
        let boundary = "career_os_drive_boundary_7f9a";
        let metadata = match folder_id {
            Some(fid) => serde_json::json!({
                "name": name,
                "mimeType": target_mime_type,
                "parents": [fid]
            }),
            None => serde_json::json!({
                "name": name,
                "mimeType": target_mime_type
            }),
        };
        let meta_str =
            serde_json::to_string(&metadata).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

        let mut body = Vec::with_capacity(meta_str.len() + bytes.len() + 256);
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta_str}\r\n--{boundary}\r\nContent-Type: {content_mime_type}\r\n\r\n"
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

pub fn google_doc_edit_url(record: &DriveFileRecord) -> String {
    record
        .web_view_link
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://docs.google.com/document/d/{}/edit", record.id))
}

fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

fn apply_delimited_tag(input: &str, marker: &str, open_tag: &str, close_tag: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find(marker) {
        out.push_str(&rest[..start]);
        let after_start = &rest[start + marker.len()..];
        if let Some(end) = after_start.find(marker) {
            if end > 0 {
                out.push_str(open_tag);
                out.push_str(&after_start[..end]);
                out.push_str(close_tag);
                rest = &after_start[end + marker.len()..];
                continue;
            }
        }
        out.push_str(marker);
        rest = after_start;
    }
    out.push_str(rest);
    out
}

fn render_inline_markdown(raw: &str) -> String {
    let escaped = escape_html(raw);
    let bolded = apply_delimited_tag(&escaped, "**", "<strong>", "</strong>");
    apply_delimited_tag(&bolded, "*", "<em>", "</em>")
}

/// Converts simple ATS-friendly Markdown to self-contained, HTML-escaped markup
/// suitable for Drive's HTML -> Google Doc import.
pub fn markdown_to_doc_html(title: &str, markdown: &str) -> String {
    let mut body = String::new();
    let mut in_list = false;
    let mut para_lines: Vec<String> = Vec::new();

    let flush_para = |buf: &mut Vec<String>, out: &mut String| {
        if !buf.is_empty() {
            out.push_str("<p>");
            out.push_str(&buf.join(" "));
            out.push_str("</p>\n");
            buf.clear();
        }
    };
    let close_list = |in_list: &mut bool, out: &mut String| {
        if *in_list {
            out.push_str("</ul>\n");
            *in_list = false;
        }
    };

    for raw_line in markdown.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            flush_para(&mut para_lines, &mut body);
            close_list(&mut in_list, &mut body);
            continue;
        }

        if trimmed == "---" || trimmed == "***" {
            flush_para(&mut para_lines, &mut body);
            close_list(&mut in_list, &mut body);
            body.push_str("<hr>\n");
            continue;
        }

        let heading = [("h4", "#### "), ("h3", "### "), ("h2", "## "), ("h1", "# ")]
            .into_iter()
            .find_map(|(tag, prefix)| trimmed.strip_prefix(prefix).map(|text| (tag, text)));

        if let Some((tag, text)) = heading {
            flush_para(&mut para_lines, &mut body);
            close_list(&mut in_list, &mut body);
            body.push_str(&format!(
                "<{tag}>{}</{tag}>\n",
                render_inline_markdown(text.trim())
            ));
            continue;
        }

        if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            flush_para(&mut para_lines, &mut body);
            if !in_list {
                body.push_str("<ul>\n");
                in_list = true;
            }
            body.push_str(&format!(
                "<li>{}</li>\n",
                render_inline_markdown(item.trim())
            ));
            continue;
        }

        close_list(&mut in_list, &mut body);
        para_lines.push(render_inline_markdown(trimmed));
    }

    flush_para(&mut para_lines, &mut body);
    close_list(&mut in_list, &mut body);

    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{}</title>\
         <style>body{{font-family:Arial,sans-serif;line-height:1.45;color:#111;max-width:760px;margin:0 auto;}}\
         h1{{font-size:18pt;margin:0 0 8pt;}}h2{{font-size:12pt;margin:14pt 0 4pt;border-bottom:1px solid #ddd;padding-bottom:2pt;}}\
         h3,h4{{font-size:10.5pt;margin:10pt 0 3pt;}}ul{{margin:4pt 0 8pt 18pt;padding:0;}}li{{margin:2pt 0;}}\
         p{{margin:4pt 0 6pt;}}hr{{border:none;border-top:1px solid #ddd;margin:10pt 0;}}</style></head>\
         <body>\n{body}</body></html>",
        escape_html(title)
    )
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

    #[test]
    fn markdown_to_doc_html_escapes_html_and_renders_blocks() {
        let html = markdown_to_doc_html(
            "Resume <Acme>",
            "# Candidate\n\n## Experience\n- Built **Rust** APIs & *SQLite* <script>alert(1)</script>\n\n---\n\nClosing line.\n",
        );
        assert!(html.contains("<title>Resume &lt;Acme&gt;</title>"));
        assert!(html.contains("<h1>Candidate</h1>"));
        assert!(html.contains("<h2>Experience</h2>"));
        assert!(html.contains("<li>Built <strong>Rust</strong> APIs &amp; <em>SQLite</em> &lt;script&gt;alert(1)&lt;/script&gt;</li>"));
        assert!(html.contains("<hr>"));
        assert!(html.contains("<p>Closing line.</p>"));
        assert!(!html.contains("<script>"));
    }

    #[tokio::test]
    async fn creates_google_doc_from_html_via_multipart() {
        let app = Router::new().route(
            "/files",
            post(|body: String| async move {
                assert!(body.contains("application/vnd.google-apps.document"));
                assert!(body.contains("Content-Type: text/html; charset=UTF-8"));
                assert!(body.contains("<h1>Resume</h1>"));
                assert!(body.contains("\"parents\":[\"out-folder\"]"));
                Json(serde_json::json!({
                    "id": "gdoc-42",
                    "name": "Resume - Acme",
                    "webViewLink": "https://docs.google.com/document/d/gdoc-42/edit",
                    "mimeType": "application/vnd.google-apps.document"
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client =
            DriveClient::new().with_bases(format!("http://{addr}"), format!("http://{addr}"));
        let rec = client
            .create_google_doc_from_html(
                "tok",
                "Resume - Acme",
                Some("out-folder"),
                "<html><body><h1>Resume</h1></body></html>",
            )
            .await
            .unwrap();
        assert_eq!(
            google_doc_edit_url(&rec),
            "https://docs.google.com/document/d/gdoc-42/edit"
        );
    }
}
