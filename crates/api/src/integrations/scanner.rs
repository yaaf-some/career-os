use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedJob {
    pub canonical_key: String,
    pub url: String,
    pub company: String,
    pub title: String,
    pub location: Option<String>,
    pub workplace_type: Option<String>,
    pub posted_at: Option<String>,
    pub source_type: String,
    pub jd_text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ScannerClient {
    http: reqwest::Client,
    greenhouse_base: String,
    ashby_base: String,
    lever_base: String,
}

impl Default for ScannerClient {
    fn default() -> Self {
        Self::new()
    }
}

impl ScannerClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent("career-os-scanner/0.1")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http,
            greenhouse_base: "https://boards-api.greenhouse.io/v1/boards".to_string(),
            ashby_base: "https://api.ashbyhq.com/posting-api/job-board".to_string(),
            lever_base: "https://api.lever.co/v0/postings".to_string(),
        }
    }

    pub fn with_bases(mut self, greenhouse: String, ashby: String, lever: String) -> Self {
        self.greenhouse_base = greenhouse.trim_end_matches('/').to_string();
        self.ashby_base = ashby.trim_end_matches('/').to_string();
        self.lever_base = lever.trim_end_matches('/').to_string();
        self
    }

    pub async fn scan_ats_board(
        &self,
        provider: &str,
        company: &str,
        board_id: &str,
    ) -> Result<Vec<ScannedJob>, AppError> {
        match provider.to_ascii_lowercase().as_str() {
            "greenhouse" => self.scan_greenhouse(company, board_id).await,
            "ashby" => self.scan_ashby(company, board_id).await,
            "lever" => self.scan_lever(company, board_id).await,
            other => Err(AppError::BadRequest(format!(
                "unsupported ATS provider: {other}"
            ))),
        }
    }

    pub async fn scan_greenhouse(
        &self,
        company: &str,
        board_id: &str,
    ) -> Result<Vec<ScannedJob>, AppError> {
        #[derive(Deserialize)]
        struct GhResp {
            #[serde(default)]
            jobs: Vec<GhJob>,
        }
        #[derive(Deserialize)]
        struct GhJob {
            title: String,
            absolute_url: String,
            location: Option<GhLoc>,
            updated_at: Option<String>,
            content: Option<String>,
        }
        #[derive(Deserialize)]
        struct GhLoc {
            name: Option<String>,
        }

        let url = format!("{}/{}/jobs?content=true", self.greenhouse_base, board_id);
        let resp = self
            .http
            .get(url.as_str())
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("greenhouse request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Upstream(format!(
                "greenhouse returned {}",
                resp.status()
            )));
        }

        let data: GhResp = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid greenhouse JSON: {e}")))?;

        Ok(data
            .jobs
            .into_iter()
            .map(|j| {
                let location = j.location.and_then(|l| l.name);
                let workplace_type = infer_workplace_type(location.as_deref(), &j.title);
                ScannedJob {
                    canonical_key: canonicalize_url_key(&j.absolute_url),
                    url: j.absolute_url,
                    company: company.to_string(),
                    title: j.title,
                    location,
                    workplace_type,
                    posted_at: j.updated_at,
                    source_type: "ats_board".to_string(),
                    jd_text: j.content,
                }
            })
            .collect())
    }

    pub async fn scan_ashby(
        &self,
        company: &str,
        board_id: &str,
    ) -> Result<Vec<ScannedJob>, AppError> {
        #[derive(Deserialize)]
        struct AshbyResp {
            #[serde(default)]
            jobs: Vec<AshbyJob>,
        }
        #[derive(Deserialize)]
        struct AshbyJob {
            title: String,
            #[serde(rename = "jobUrl")]
            job_url: String,
            location: Option<String>,
            #[serde(rename = "publishedAt")]
            published_at: Option<String>,
            #[serde(rename = "descriptionPlain")]
            description_plain: Option<String>,
            #[serde(rename = "isRemote")]
            is_remote: Option<bool>,
        }

        let url = format!("{}/{}", self.ashby_base, board_id);
        let resp = self
            .http
            .get(url.as_str())
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("ashby request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Upstream(format!(
                "ashby returned {}",
                resp.status()
            )));
        }

        let data: AshbyResp = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid ashby JSON: {e}")))?;

        Ok(data
            .jobs
            .into_iter()
            .map(|j| {
                let workplace_type = if j.is_remote == Some(true) {
                    Some("remote".to_string())
                } else {
                    infer_workplace_type(j.location.as_deref(), &j.title)
                };
                ScannedJob {
                    canonical_key: canonicalize_url_key(&j.job_url),
                    url: j.job_url,
                    company: company.to_string(),
                    title: j.title,
                    location: j.location,
                    workplace_type,
                    posted_at: j.published_at,
                    source_type: "ats_board".to_string(),
                    jd_text: j.description_plain,
                }
            })
            .collect())
    }

    pub async fn scan_lever(
        &self,
        company: &str,
        board_id: &str,
    ) -> Result<Vec<ScannedJob>, AppError> {
        #[derive(Deserialize)]
        struct LeverJob {
            text: String,
            #[serde(rename = "hostedUrl")]
            hosted_url: String,
            categories: Option<LeverCats>,
            #[serde(rename = "descriptionPlain")]
            description_plain: Option<String>,
            #[serde(rename = "workplaceType")]
            workplace_type: Option<String>,
        }
        #[derive(Deserialize)]
        struct LeverCats {
            location: Option<String>,
        }

        let url = format!("{}/{}?mode=json", self.lever_base, board_id);
        let resp = self
            .http
            .get(url.as_str())
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("lever request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Upstream(format!(
                "lever returned {}",
                resp.status()
            )));
        }

        let data: Vec<LeverJob> = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid lever JSON: {e}")))?;

        Ok(data
            .into_iter()
            .map(|j| {
                let location = j.categories.and_then(|c| c.location);
                let workplace_type = j
                    .workplace_type
                    .as_deref()
                    .and_then(normalize_workplace)
                    .or_else(|| infer_workplace_type(location.as_deref(), &j.text));
                ScannedJob {
                    canonical_key: canonicalize_url_key(&j.hosted_url),
                    url: j.hosted_url,
                    company: company.to_string(),
                    title: j.text,
                    location,
                    workplace_type,
                    posted_at: None,
                    source_type: "ats_board".to_string(),
                    jd_text: j.description_plain,
                }
            })
            .collect())
    }

    pub async fn fetch_reddit_rss(
        &self,
        feed_url: &str,
        label: &str,
    ) -> Result<Vec<ScannedJob>, AppError> {
        let resp = self
            .http
            .get(feed_url)
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("reddit rss request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Upstream(format!(
                "reddit rss returned {}",
                resp.status()
            )));
        }

        let xml = resp
            .text()
            .await
            .map_err(|e| AppError::Upstream(format!("failed reading reddit rss body: {e}")))?;

        Ok(parse_reddit_feed_xml(&xml, label))
    }
}

/// Parse Reddit Atom (`<entry>`) or RSS (`<item>`) feeds without requiring a heavy XML crate.
pub fn parse_reddit_feed_xml(xml: &str, community_label: &str) -> Vec<ScannedJob> {
    let mut jobs = Vec::new();
    let chunks: Vec<&str> = if xml.contains("<entry>") {
        xml.split("<entry>").skip(1).collect()
    } else {
        xml.split("<item>").skip(1).collect()
    };

    for chunk in chunks {
        let title = extract_xml_tag(chunk, "title").unwrap_or_default();
        let link = extract_atom_link(chunk)
            .or_else(|| extract_xml_tag(chunk, "link"))
            .unwrap_or_default();
        if title.is_empty() || link.is_empty() {
            continue;
        }
        let body =
            extract_xml_tag(chunk, "content").or_else(|| extract_xml_tag(chunk, "description"));
        let posted_at =
            extract_xml_tag(chunk, "updated").or_else(|| extract_xml_tag(chunk, "pubDate"));

        jobs.push(ScannedJob {
            canonical_key: canonicalize_url_key(&link),
            url: link,
            company: community_label.to_string(),
            title: decode_basic_entities(&title),
            location: None,
            workplace_type: infer_workplace_type(None, &title),
            posted_at,
            source_type: "reddit".to_string(),
            jd_text: body.map(|b| decode_basic_entities(&b)),
        });
    }

    jobs
}

fn extract_xml_tag(haystack: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start_idx = haystack.find(&open)?;
    let after_open = &haystack[start_idx + open.len()..];
    let close_gt = after_open.find('>')?;
    let content_start = &after_open[close_gt + 1..];
    let end_tag = format!("</{tag}>");
    let end_idx = content_start.find(&end_tag)?;
    let raw = content_start[..end_idx].trim();
    let cleaned = raw
        .strip_prefix("<![CDATA[")
        .and_then(|s| s.strip_suffix("]]>"))
        .unwrap_or(raw)
        .trim();
    Some(cleaned.to_string())
}

fn extract_atom_link(haystack: &str) -> Option<String> {
    let idx = haystack.find("<link ")?;
    let after = &haystack[idx..];
    let tag_end = after.find('>')?;
    let tag_slice = &after[..tag_end];
    let href_idx = tag_slice.find("href=\"")?;
    let rest = &tag_slice[href_idx + 6..];
    let end_quote = rest.find('"')?;
    Some(rest[..end_quote].to_string())
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub fn canonicalize_url_key(raw_url: &str) -> String {
    let trimmed = raw_url.trim();
    if let Ok(mut parsed) = reqwest::Url::parse(trimmed) {
        let filtered_pairs: Vec<(String, String)> = parsed
            .query_pairs()
            .filter(|(k, _)| {
                let kl = k.to_ascii_lowercase();
                !kl.starts_with("utm_") && kl != "gh_src" && kl != "source" && kl != "ref"
            })
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        if filtered_pairs.is_empty() {
            parsed.set_query(None);
        } else {
            parsed
                .query_pairs_mut()
                .clear()
                .extend_pairs(filtered_pairs);
        }
        parsed.set_fragment(None);
        let s = parsed.to_string();
        return s.trim_end_matches('/').to_ascii_lowercase();
    }
    trimmed.trim_end_matches('/').to_ascii_lowercase()
}

fn normalize_workplace(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("remote") {
        Some("remote".to_string())
    } else if lower.contains("hybrid") {
        Some("hybrid".to_string())
    } else if lower.contains("onsite") || lower.contains("on-site") {
        Some("onsite".to_string())
    } else {
        None
    }
}

fn infer_workplace_type(location: Option<&str>, title: &str) -> Option<String> {
    if let Some(loc) = location {
        if let Some(w) = normalize_workplace(loc) {
            return Some(w);
        }
    }
    normalize_workplace(title)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use tokio::net::TcpListener;

    #[test]
    fn canonicalizes_urls_by_stripping_utm_and_trailing_slash() {
        let a = canonicalize_url_key(
            "https://boards.greenhouse.io/acme/jobs/123/?utm_source=x&gh_src=y",
        );
        let b = canonicalize_url_key("https://boards.greenhouse.io/acme/jobs/123");
        assert_eq!(a, b);
    }

    #[test]
    fn parses_reddit_atom_feed() {
        let xml = r#"
        <feed>
          <entry>
            <title>[Hiring] Staff Rust Engineer (Remote)</title>
            <link href="https://www.reddit.com/r/rust/comments/xyz/hiring/?utm_source=rss" />
            <updated>2026-11-26T10:00:00+00:00</updated>
            <content type="html">Systems &amp; distributed backend role.</content>
          </entry>
        </feed>
        "#;
        let parsed = parse_reddit_feed_xml(xml, "r/rust");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "[Hiring] Staff Rust Engineer (Remote)");
        assert_eq!(parsed[0].workplace_type.as_deref(), Some("remote"));
        assert_eq!(parsed[0].source_type, "reddit");
    }

    #[tokio::test]
    async fn scans_greenhouse_board_against_mock_server() {
        let app = Router::new().route(
            "/gh/acme/jobs",
            get(|| async {
                Json(serde_json::json!({
                    "jobs": [{
                        "title": "Senior Backend Engineer",
                        "absolute_url": "https://boards.greenhouse.io/acme/jobs/999",
                        "location": { "name": "Remote - US" },
                        "updated_at": "2026-11-25T12:00:00Z",
                        "content": "Build Rust services"
                    }]
                }))
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let scanner = ScannerClient::new().with_bases(
            format!("http://{addr}/gh"),
            format!("http://{addr}/ashby"),
            format!("http://{addr}/lever"),
        );
        let jobs = scanner
            .scan_ats_board("greenhouse", "Acme", "acme")
            .await
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].workplace_type.as_deref(), Some("remote"));
    }
}
