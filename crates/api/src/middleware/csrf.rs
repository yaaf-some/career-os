//! Blocks cross-site writes. `tailscale serve` adds the identity header to any
//! request from the owner's browser, so identity alone cannot tell the app's
//! own requests from ones another website triggered.

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::error::AppError;

/// True when a state-changing request comes from the app itself or from a
/// non-browser client (which sends neither `Sec-Fetch-Site` nor `Origin`).
pub fn is_allowed_write(method: &Method, headers: &HeaderMap, cors_origin: Option<&str>) -> bool {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return true;
    }
    let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let origin = get(header::ORIGIN.as_str());
    if origin.is_some() && origin == cors_origin {
        return true;
    }
    // Set by the browser and unaffected by proxies, so prefer it.
    if let Some(site) = get("sec-fetch-site") {
        return matches!(site, "same-origin" | "none");
    }
    let Some(origin) = origin else {
        return true;
    };
    let Some((_, authority)) = origin.split_once("://") else {
        return false;
    };
    [get(header::HOST.as_str()), get("x-forwarded-host")]
        .into_iter()
        .flatten()
        .any(|host| host.eq_ignore_ascii_case(authority))
}

pub async fn same_origin_writes(
    State(cors_origin): State<Option<String>>,
    req: Request,
    next: Next,
) -> Response {
    if is_allowed_write(req.method(), req.headers(), cors_origin.as_deref()) {
        next.run(req).await
    } else {
        AppError::Forbidden("cross-site request blocked".into()).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        pairs
            .iter()
            .map(|(k, v)| (k.parse().unwrap(), HeaderValue::from_static(v)))
            .collect()
    }

    #[test]
    fn allows_own_and_non_browser_writes_only() {
        let post = Method::POST;
        let allowed =
            |h: &[(&'static str, &'static str)]| is_allowed_write(&post, &headers(h), None);

        assert!(allowed(&[]));
        assert!(allowed(&[("sec-fetch-site", "same-origin")]));
        assert!(allowed(&[
            ("origin", "https://host.example:8080"),
            ("host", "host.example:8080")
        ]));
        assert!(!allowed(&[("sec-fetch-site", "cross-site")]));
        // Another service on the same machine, different port.
        assert!(!allowed(&[("sec-fetch-site", "same-site")]));
        assert!(!allowed(&[
            ("origin", "https://evil.example"),
            ("host", "host.example:8080")
        ]));
        assert!(!allowed(&[("origin", "null"), ("host", "host.example")]));
    }

    #[test]
    fn reads_and_the_configured_dev_origin_pass() {
        let cross = headers(&[("sec-fetch-site", "cross-site")]);
        assert!(is_allowed_write(&Method::GET, &cross, None));
        let dev = headers(&[
            ("sec-fetch-site", "cross-site"),
            ("origin", "http://localhost:5173"),
        ]);
        assert!(is_allowed_write(
            &Method::POST,
            &dev,
            Some("http://localhost:5173")
        ));
    }
}
