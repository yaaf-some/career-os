use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

use crate::{
    db::{new_id, now_iso},
    error::AppError,
    integrations::maps::{normalize_travel_mode, CommuteEstimate},
    routes::settings::{HOME_LOCATION_AREA_KEY, TRAVEL_MODE_KEY},
    state::AppState,
};

const CACHE_TTL_DAYS: i64 = 30;
const METERS_PER_MILE: f64 = 1609.344;

#[derive(Debug, Serialize, ToSchema)]
pub struct CommuteInfoResponse {
    pub is_remote: bool,
    pub configured: bool,
    pub origin_area: Option<String>,
    pub destination_query: Option<String>,
    pub resolved_address: Option<String>,
    pub distance_miles: Option<f64>,
    pub duration_minutes: Option<i64>,
    pub travel_mode: String,
    pub estimate_source: Option<String>,
    pub cached: bool,
    pub maps_url: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommutePreviewRequest {
    pub origin_area: Option<String>,
    pub destination: String,
    pub travel_mode: Option<String>,
}

#[derive(Debug, FromRow)]
struct JobLocationRow {
    company: String,
    location: Option<String>,
    workplace_type: Option<String>,
}

#[derive(Debug, FromRow)]
struct CommuteCacheRow {
    resolved_address: Option<String>,
    distance_meters: Option<i64>,
    duration_seconds: Option<i64>,
    travel_mode: String,
    estimate_source: String,
    maps_url: Option<String>,
    fetched_at: String,
}

#[utoipa::path(
    get,
    path = "/api/jobs/{id}/commute",
    params(
        ("id" = String, Path, description = "Job ID")
    ),
    responses(
        (status = 200, description = "Commute distance & duration from home LA area to job location", body = CommuteInfoResponse),
        (status = 404, description = "Job not found", body = crate::error::ErrorResponse)
    ),
    tag = "commute"
)]
pub async fn get_job_commute(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CommuteInfoResponse>, AppError> {
    let job = sqlx::query_as::<_, JobLocationRow>(
        "SELECT company, location, workplace_type FROM jobs WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {id} not found")))?;

    let (origin_area, travel_mode) = load_commute_prefs(&state).await?;

    if is_remote_job(job.workplace_type.as_deref(), job.location.as_deref()) {
        return Ok(Json(CommuteInfoResponse {
            is_remote: true,
            configured: state.maps.is_configured() && origin_area.is_some(),
            origin_area,
            destination_query: job.location,
            resolved_address: None,
            distance_miles: None,
            duration_minutes: None,
            travel_mode,
            estimate_source: None,
            cached: false,
            maps_url: None,
        }));
    }

    let destination_query = match job.location.as_deref() {
        Some(loc) if !loc.trim().is_empty() => format!("{}, {}", job.company, loc.trim()),
        _ => job.company.clone(),
    };

    let Some(origin) = origin_area else {
        return Ok(Json(CommuteInfoResponse {
            is_remote: false,
            configured: false,
            origin_area: None,
            destination_query: Some(destination_query),
            resolved_address: None,
            distance_miles: None,
            duration_minutes: None,
            travel_mode,
            estimate_source: None,
            cached: false,
            maps_url: None,
        }));
    };

    let res = lookup_or_fetch_commute(&state, &origin, &destination_query, &travel_mode).await?;
    Ok(Json(res))
}

#[utoipa::path(
    post,
    path = "/api/commute/preview",
    request_body = CommutePreviewRequest,
    responses(
        (status = 200, description = "Preview commute distance & duration using Maps + Places API", body = CommuteInfoResponse),
        (status = 400, description = "Missing home area or destination", body = crate::error::ErrorResponse)
    ),
    tag = "commute"
)]
pub async fn preview_commute(
    State(state): State<AppState>,
    Json(req): Json<CommutePreviewRequest>,
) -> Result<Json<CommuteInfoResponse>, AppError> {
    let dest = req.destination.trim();
    if dest.is_empty() {
        return Err(AppError::BadRequest("destination is required".to_string()));
    }

    let (saved_origin, saved_mode) = load_commute_prefs(&state).await?;
    let origin = req
        .origin_area
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(saved_origin)
        .ok_or_else(|| {
            AppError::BadRequest(
                "home_location_area is not set in Settings or HOME_LOCATION_AREA".to_string(),
            )
        })?;
    let travel_mode = req
        .travel_mode
        .as_deref()
        .map(normalize_travel_mode)
        .unwrap_or(saved_mode);

    let res = lookup_or_fetch_commute(&state, &origin, dest, &travel_mode).await?;
    Ok(Json(res))
}

async fn lookup_or_fetch_commute(
    state: &AppState,
    origin: &str,
    destination: &str,
    travel_mode: &str,
) -> Result<CommuteInfoResponse, AppError> {
    let origin_key = origin.trim().to_ascii_lowercase();
    let dest_norm = destination.trim().to_string();
    let mode = normalize_travel_mode(travel_mode);

    let cached = sqlx::query_as::<_, CommuteCacheRow>(
        r#"
        SELECT resolved_address, distance_meters, duration_seconds, travel_mode, estimate_source, maps_url, fetched_at
        FROM commute_cache
        WHERE origin_key = ?1 AND destination_query = ?2 AND travel_mode = ?3
        "#,
    )
    .bind(&origin_key)
    .bind(&dest_norm)
    .bind(&mode)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(row) = cached {
        if is_cache_fresh(&row.fetched_at, Utc::now()) {
            return Ok(build_response(
                origin,
                &dest_norm,
                state.maps.is_configured(),
                true,
                row.resolved_address,
                row.distance_meters,
                row.duration_seconds,
                row.travel_mode,
                Some(row.estimate_source),
                row.maps_url,
            ));
        }
    }

    if !state.maps.is_configured() {
        return Ok(CommuteInfoResponse {
            is_remote: false,
            configured: false,
            origin_area: Some(origin.to_string()),
            destination_query: Some(dest_norm),
            resolved_address: None,
            distance_miles: None,
            duration_minutes: None,
            travel_mode: mode,
            estimate_source: None,
            cached: false,
            maps_url: None,
        });
    }

    let est: CommuteEstimate = state
        .maps
        .compute_commute(origin, &dest_norm, &mode)
        .await?;
    let now = now_iso();
    sqlx::query(
        r#"
        INSERT INTO commute_cache (
            id, origin_key, destination_query, resolved_address, place_id,
            distance_meters, duration_seconds, travel_mode, estimate_source, maps_url, fetched_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(origin_key, destination_query, travel_mode) DO UPDATE SET
            resolved_address = excluded.resolved_address,
            place_id = excluded.place_id,
            distance_meters = excluded.distance_meters,
            duration_seconds = excluded.duration_seconds,
            estimate_source = excluded.estimate_source,
            maps_url = excluded.maps_url,
            fetched_at = excluded.fetched_at
        "#,
    )
    .bind(new_id())
    .bind(&origin_key)
    .bind(&dest_norm)
    .bind(&est.resolved_address)
    .bind(&est.place_id)
    .bind(est.distance_meters)
    .bind(est.duration_seconds)
    .bind(&est.travel_mode)
    .bind(&est.estimate_source)
    .bind(&est.maps_url)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    Ok(build_response(
        origin,
        &dest_norm,
        true,
        false,
        est.resolved_address,
        Some(est.distance_meters),
        Some(est.duration_seconds),
        est.travel_mode,
        Some(est.estimate_source),
        Some(est.maps_url),
    ))
}

#[allow(clippy::too_many_arguments)]
fn build_response(
    origin: &str,
    destination: &str,
    configured: bool,
    cached: bool,
    resolved_address: Option<String>,
    distance_meters: Option<i64>,
    duration_seconds: Option<i64>,
    travel_mode: String,
    estimate_source: Option<String>,
    maps_url: Option<String>,
) -> CommuteInfoResponse {
    let distance_miles =
        distance_meters.map(|m| ((m as f64 / METERS_PER_MILE) * 10.0).round() / 10.0);
    let duration_minutes = duration_seconds.map(|s| ((s as f64) / 60.0).round() as i64);

    CommuteInfoResponse {
        is_remote: false,
        configured,
        origin_area: Some(origin.to_string()),
        destination_query: Some(destination.to_string()),
        resolved_address,
        distance_miles,
        duration_minutes,
        travel_mode,
        estimate_source,
        cached,
        maps_url,
    }
}

async fn load_commute_prefs(state: &AppState) -> Result<(Option<String>, String), AppError> {
    let home_setting = load_string_setting(&state.pool, HOME_LOCATION_AREA_KEY).await?;
    let mode_setting = load_string_setting(&state.pool, TRAVEL_MODE_KEY).await?;

    let origin = home_setting.or_else(|| state.config.home_location_area.clone());
    let mode = mode_setting
        .as_deref()
        .map(normalize_travel_mode)
        .unwrap_or_else(|| state.config.default_travel_mode.clone());
    Ok((origin, mode))
}

async fn load_string_setting(
    pool: &sqlx::SqlitePool,
    key: &str,
) -> Result<Option<String>, AppError> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    Ok(raw.and_then(|json_str| {
        serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|v| v.as_str().map(str::trim).map(str::to_string))
            .filter(|s| !s.is_empty())
    }))
}

fn is_remote_job(workplace_type: Option<&str>, location: Option<&str>) -> bool {
    if matches!(workplace_type, Some("remote")) {
        return true;
    }
    let Some(loc) = location else {
        return false;
    };
    let lower = loc.to_ascii_lowercase();
    lower.contains("remote")
        && !lower.contains("hybrid")
        && !lower.contains("los angeles")
        && !lower.contains("santa monica")
        && !lower.contains("culver city")
        && !lower.contains("irvine")
}

fn is_cache_fresh(fetched_at: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(fetched_at)
        .ok()
        .map(|dt| dt.with_timezone(&Utc) + Duration::days(CACHE_TTL_DAYS) > now)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use axum::{routing::post, Json, Router};
    use tokio::net::TcpListener;

    use super::*;
    use crate::{
        ai::MockAiProvider,
        config::AppConfig,
        db::init_pool,
        integrations::{
            calendar::CalendarClient, drive::DriveClient, gmail::GmailClient, maps::MapsClient,
            scanner::ScannerClient,
        },
    };

    #[tokio::test]
    async fn caches_commute_lookups_and_bypasses_remote_jobs() {
        let pool = init_pool("sqlite::memory:").await.unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_places = Arc::clone(&calls);

        let mock_app = Router::new()
            .route(
                "/places",
                post(move || {
                    let c = Arc::clone(&calls_places);
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                        Json(serde_json::json!({
                            "places": [{
                                "id": "ChIJ-dest",
                                "formattedAddress": "Santa Monica, CA 90401, USA",
                                "location": { "latitude": 34.0195, "longitude": -118.4912 }
                            }]
                        }))
                    }
                }),
            )
            .route(
                "/routes",
                post(|| async {
                    Json(serde_json::json!({
                        "routes": [{
                            "distanceMeters": 11909,
                            "duration": "1140s"
                        }]
                    }))
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, mock_app).await.unwrap();
        });

        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, location, workplace_type, source_type)
             VALUES ('j-la', 'https://example.com/la', 'https://example.com/la', 'Coastal Cloud', 'Platform Engineer', 'Santa Monica, CA (Hybrid)', 'hybrid', 'manual'),
                    ('j-rem', 'https://example.com/rem', 'https://example.com/rem', 'Remote Corp', 'SRE', 'Remote (US)', 'remote', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let state = AppState {
            pool,
            config: Arc::new(AppConfig {
                home_location_area: Some("West Los Angeles, CA".to_string()),
                scheduler_enabled: false,
                ..AppConfig::default()
            }),
            ai: Arc::new(MockAiProvider),
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(Some("maps-key".to_string())).with_endpoints(
                format!("http://{addr}/places"),
                format!("http://{addr}/routes"),
            ),
            sync_lock: Default::default(),
            linear: None,
        };

        let remote_res = get_job_commute(State(state.clone()), Path("j-rem".to_string()))
            .await
            .unwrap()
            .0;
        assert!(remote_res.is_remote);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let first = get_job_commute(State(state.clone()), Path("j-la".to_string()))
            .await
            .unwrap()
            .0;
        assert!(!first.is_remote);
        assert!(!first.cached);
        assert_eq!(first.distance_miles, Some(7.4));
        assert_eq!(first.duration_minutes, Some(19));
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let second = get_job_commute(State(state.clone()), Path("j-la".to_string()))
            .await
            .unwrap()
            .0;
        assert!(second.cached);
        assert_eq!(second.distance_miles, Some(7.4));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn saved_commute_settings_override_env_defaults() {
        use crate::routes::settings::{upsert_setting, UpsertSettingRequest};

        let pool = init_pool("sqlite::memory:").await.unwrap();
        let state = AppState {
            pool,
            config: Arc::new(AppConfig {
                home_location_area: Some("Env Area, CA".to_string()),
                scheduler_enabled: false,
                ..AppConfig::default()
            }),
            ai: Arc::new(MockAiProvider),
            cipher: None,
            scanner: ScannerClient::new(),
            gmail: GmailClient::new(),
            drive: DriveClient::new(),
            calendar: CalendarClient::new(),
            maps: MapsClient::new(None),
            sync_lock: Default::default(),
            linear: None,
        };

        let (origin, mode) = load_commute_prefs(&state).await.unwrap();
        assert_eq!(origin.as_deref(), Some("Env Area, CA"));
        assert_eq!(mode, state.config.default_travel_mode);

        for (key, value) in [
            (HOME_LOCATION_AREA_KEY, "Pasadena, CA"),
            (TRAVEL_MODE_KEY, "transit"),
        ] {
            let _saved = upsert_setting(
                State(state.clone()),
                Path(key.to_string()),
                Json(UpsertSettingRequest {
                    value: serde_json::json!(value),
                }),
            )
            .await
            .unwrap();
        }
        let (origin, mode) = load_commute_prefs(&state).await.unwrap();
        assert_eq!(origin.as_deref(), Some("Pasadena, CA"));
        assert_eq!(mode, "TRANSIT");
    }
}
