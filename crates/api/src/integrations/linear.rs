use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

#[derive(Debug, Clone)]
pub struct LinearClient {
    http: reqwest::Client,
    graphql_url: String,
    api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueSummary {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct IssueCreateData {
    #[serde(rename = "issueCreate")]
    issue_create: IssueCreatePayload,
}

#[derive(Debug, Deserialize)]
struct IssueCreatePayload {
    success: bool,
    issue: Option<LinearIssueSummary>,
}

impl LinearClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            graphql_url: LINEAR_GRAPHQL_URL.to_string(),
            api_key,
        }
    }

    pub fn with_url(mut self, graphql_url: String) -> Self {
        self.graphql_url = graphql_url;
        self
    }

    pub async fn create_issue(
        &self,
        team_id: &str,
        title: &str,
        description: &str,
    ) -> Result<LinearIssueSummary, AppError> {
        let query = r#"
            mutation IssueCreate($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue {
                        id
                        identifier
                        title
                        url
                    }
                }
            }
        "#;

        let body = serde_json::json!({
            "query": query,
            "variables": {
                "input": {
                    "teamId": team_id,
                    "title": title,
                    "description": description
                }
            }
        });

        let resp = self
            .http
            .post(self.graphql_url.as_str())
            .header("Authorization", self.api_key.as_str())
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("linear request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "linear returned {status}: {err_text}"
            )));
        }

        let gql: GraphQlResponse<IssueCreateData> = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid linear JSON: {e}")))?;

        if let Some(errors) = gql.errors {
            let msgs: Vec<String> = errors.into_iter().map(|e| e.message).collect();
            return Err(AppError::Upstream(format!(
                "linear GraphQL errors: {}",
                msgs.join("; ")
            )));
        }

        let issue = gql
            .data
            .filter(|d| d.issue_create.success)
            .and_then(|d| d.issue_create.issue)
            .ok_or_else(|| AppError::Upstream("linear issueCreate did not return an issue".to_string()))?;

        Ok(issue)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn creates_linear_issue_via_graphql() {
        let app = Router::new().route(
            "/graphql",
            post(|| async {
                Json(serde_json::json!({
                    "data": {
                        "issueCreate": {
                            "success": true,
                            "issue": {
                                "id": "lin-uuid-1",
                                "identifier": "JOB-42",
                                "title": "Apply: Acme - Staff Engineer",
                                "url": "https://linear.app/team/issue/JOB-42"
                            }
                        }
                    }
                }))
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = LinearClient::new("lin_api_test".to_string())
            .with_url(format!("http://{addr}/graphql"));
        let issue = client
            .create_issue("team-1", "Apply: Acme - Staff Engineer", "Notes")
            .await
            .unwrap();
        assert_eq!(issue.identifier, "JOB-42");
    }
}
