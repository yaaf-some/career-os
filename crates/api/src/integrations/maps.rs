use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const GOOGLE_PLACES_SEARCH_ENDPOINT: &str =
    "https://places.googleapis.com/v1/places:searchText";
pub const GOOGLE_ROUTES_COMPUTE_ENDPOINT: &str =
    "https://routes.googleapis.com/directions/v2:computeRoutes";

#[derive(Debug, Clone)]
pub struct MapsClient {
    http: reqwest::Client,
    api_key: Option<String>,
    places_endpoint: String,
    routes_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedPlace {
    pub place_id: Option<String>,
    pub formatted_address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub maps_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommuteEstimate {
    pub resolved_address: Option<String>,
    pub place_id: Option<String>,
    pub distance_meters: i64,
    pub duration_seconds: i64,
    pub travel_mode: String,
    pub estimate_source: String,
    pub maps_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacesSearchResponse {
    #[serde(default)]
    places: Vec<PlaceItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceItem {
    id: Option<String>,
    formatted_address: Option<String>,
    location: Option<LatLng>,
    google_maps_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LatLng {
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutesResponse {
    #[serde(default)]
    routes: Vec<RouteItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteItem {
    distance_meters: Option<i64>,
    duration: Option<String>,
}

impl MapsClient {
    pub fn new(api_key: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key,
            places_endpoint: GOOGLE_PLACES_SEARCH_ENDPOINT.to_string(),
            routes_endpoint: GOOGLE_ROUTES_COMPUTE_ENDPOINT.to_string(),
        }
    }

    pub fn with_endpoints(mut self, places_endpoint: String, routes_endpoint: String) -> Self {
        self.places_endpoint = places_endpoint;
        self.routes_endpoint = routes_endpoint;
        self
    }

    pub fn is_configured(&self) -> bool {
        self.api_key
            .as_deref()
            .is_some_and(|k| !k.trim().is_empty())
    }

    /// Resolves a free-form destination or area query via Google Places API (New).
    pub async fn search_place(&self, query: &str) -> Result<ResolvedPlace, AppError> {
        let api_key = self
            .api_key
            .as_deref()
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| AppError::Config("GOOGLE_MAPS_API_KEY is not configured".to_string()))?;

        let resp = self
            .http
            .post(&self.places_endpoint)
            .header("X-Goog-Api-Key", api_key)
            .header(
                "X-Goog-FieldMask",
                "places.id,places.formattedAddress,places.location,places.googleMapsUri",
            )
            .json(&serde_json::json!({
                "textQuery": query,
                "maxResultCount": 1
            }))
            .send()
            .await
            .map_err(|e| AppError::Upstream(format!("google places search failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Upstream(format!(
                "google places API returned {status}: {body}"
            )));
        }

        let parsed: PlacesSearchResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Upstream(format!("invalid google places JSON: {e}")))?;

        let Some(place) = parsed.places.into_iter().next() else {
            return Err(AppError::NotFound(format!(
                "no matching Google Place found for '{query}'"
            )));
        };

        Ok(ResolvedPlace {
            place_id: place.id,
            formatted_address: place.formatted_address,
            latitude: place.location.as_ref().map(|l| l.latitude),
            longitude: place.location.as_ref().map(|l| l.longitude),
            maps_uri: place.google_maps_uri,
        })
    }

    /// Resolves destination via Places API and computes route distance/duration,
    /// falling back to Places Haversine distance when Routes API is not enabled.
    pub async fn compute_commute(
        &self,
        origin_area: &str,
        destination_query: &str,
        travel_mode: &str,
    ) -> Result<CommuteEstimate, AppError> {
        let mode = normalize_travel_mode(travel_mode);
        let dest_place = self.search_place(destination_query).await?;
        let dest_label = dest_place
            .formatted_address
            .as_deref()
            .unwrap_or(destination_query);
        let maps_url = build_google_maps_directions_url(origin_area, dest_label, &mode);

        if let Some((distance_meters, duration_seconds)) = self
            .try_routes_api(
                origin_area,
                dest_place.place_id.as_deref(),
                dest_label,
                &mode,
            )
            .await?
        {
            return Ok(CommuteEstimate {
                resolved_address: dest_place.formatted_address,
                place_id: dest_place.place_id,
                distance_meters,
                duration_seconds,
                travel_mode: mode,
                estimate_source: "routes_api".to_string(),
                maps_url,
            });
        }

        // Defensive fallback using Places API coordinates if Routes API is disabled on the GCP project.
        let origin_place = self.search_place(origin_area).await?;
        if let (Some(lat1), Some(lon1), Some(lat2), Some(lon2)) = (
            origin_place.latitude,
            origin_place.longitude,
            dest_place.latitude,
            dest_place.longitude,
        ) {
            let meters = haversine_meters(lat1, lon1, lat2, lon2).round() as i64;
            // Approximate LA arterial speed: ~25 mph (11.2 m/s) for drive, ~15 mph (6.7 m/s) for transit.
            let speed_mps = if mode == "TRANSIT" { 6.7 } else { 11.2 };
            let duration_seconds = ((meters as f64 / speed_mps).round() as i64).max(60);
            return Ok(CommuteEstimate {
                resolved_address: dest_place.formatted_address,
                place_id: dest_place.place_id,
                distance_meters: meters,
                duration_seconds,
                travel_mode: mode,
                estimate_source: "places_haversine".to_string(),
                maps_url,
            });
        }

        Err(AppError::Upstream(
            "could not compute commute via Routes API or Places coordinates".to_string(),
        ))
    }

    async fn try_routes_api(
        &self,
        origin_area: &str,
        dest_place_id: Option<&str>,
        dest_address: &str,
        travel_mode: &str,
    ) -> Result<Option<(i64, i64)>, AppError> {
        let Some(api_key) = self.api_key.as_deref().filter(|k| !k.trim().is_empty()) else {
            return Ok(None);
        };

        let destination_payload = match dest_place_id {
            Some(pid) if !pid.is_empty() => serde_json::json!({ "placeId": pid }),
            _ => serde_json::json!({ "address": dest_address }),
        };

        let resp = self
            .http
            .post(&self.routes_endpoint)
            .header("X-Goog-Api-Key", api_key)
            .header("X-Goog-FieldMask", "routes.distanceMeters,routes.duration")
            .json(&serde_json::json!({
                "origin": { "address": origin_area },
                "destination": destination_payload,
                "travelMode": travel_mode,
            }))
            .send()
            .await;

        let Ok(resp) = resp else {
            return Ok(None);
        };
        if !resp.status().is_success() {
            return Ok(None);
        }

        let Ok(parsed) = resp.json::<RoutesResponse>().await else {
            return Ok(None);
        };

        let Some(route) = parsed.routes.into_iter().next() else {
            return Ok(None);
        };
        let Some(distance_meters) = route.distance_meters else {
            return Ok(None);
        };
        let duration_seconds = route
            .duration
            .as_deref()
            .and_then(parse_google_duration_secs)
            .unwrap_or(0);

        Ok(Some((distance_meters, duration_seconds)))
    }
}

pub fn normalize_travel_mode(raw: &str) -> String {
    match raw.trim().to_ascii_uppercase().as_str() {
        "TRANSIT" => "TRANSIT".to_string(),
        _ => "DRIVE".to_string(),
    }
}

pub fn parse_google_duration_secs(raw: &str) -> Option<i64> {
    raw.trim()
        .strip_suffix('s')?
        .parse::<f64>()
        .ok()
        .map(|v| v.round() as i64)
}

pub fn haversine_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const EARTH_RADIUS_M: f64 = 6_371_000.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    EARTH_RADIUS_M * c
}

pub fn build_google_maps_directions_url(
    origin: &str,
    destination: &str,
    travel_mode: &str,
) -> String {
    let mode_param = if travel_mode.eq_ignore_ascii_case("TRANSIT") {
        "transit"
    } else {
        "driving"
    };
    reqwest::Url::parse_with_params(
        "https://www.google.com/maps/dir/",
        &[
            ("api", "1"),
            ("origin", origin),
            ("destination", destination),
            ("travelmode", mode_param),
        ],
    )
    .map(|u| u.to_string())
    .unwrap_or_else(|_| "https://www.google.com/maps".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::post, Json, Router};
    use tokio::net::TcpListener;

    #[test]
    fn haversine_distance_between_west_la_and_santa_monica_is_reasonable() {
        // West LA (~34.045, -118.445) -> Santa Monica (~34.0195, -118.4912) ~ 5.1 km
        let d = haversine_meters(34.045, -118.445, 34.0195, -118.4912);
        assert!(d > 4_000.0 && d < 6_500.0, "unexpected distance: {d}");
    }

    #[tokio::test]
    async fn computes_commute_via_places_and_routes_api() {
        let app = Router::new()
            .route(
                "/places",
                post(|| async {
                    Json(serde_json::json!({
                        "places": [{
                            "id": "ChIJ-santa-monica",
                            "formattedAddress": "Santa Monica, CA 90401, USA",
                            "location": { "latitude": 34.0195, "longitude": -118.4912 },
                            "googleMapsUri": "https://maps.google.com/?cid=123"
                        }]
                    }))
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
            axum::serve(listener, app).await.unwrap();
        });

        let client = MapsClient::new(Some("maps-test-key".to_string())).with_endpoints(
            format!("http://{addr}/places"),
            format!("http://{addr}/routes"),
        );

        let est = client
            .compute_commute(
                "West Los Angeles, CA",
                "Example Co Santa Monica, CA",
                "DRIVE",
            )
            .await
            .unwrap();
        assert_eq!(est.distance_meters, 11909);
        assert_eq!(est.duration_seconds, 1140);
        assert_eq!(est.estimate_source, "routes_api");
        assert!(est.maps_url.contains("travelmode=driving"));
    }

    #[tokio::test]
    async fn falls_back_to_places_haversine_when_routes_api_disabled() {
        let app = Router::new()
            .route(
                "/places",
                post(|Json(body): Json<serde_json::Value>| async move {
                    let q = body["textQuery"].as_str().unwrap_or_default();
                    if q.contains("West") {
                        Json(serde_json::json!({
                            "places": [{
                                "id": "ChIJ-origin",
                                "formattedAddress": "West Los Angeles, CA",
                                "location": { "latitude": 34.045, "longitude": -118.445 }
                            }]
                        }))
                    } else {
                        Json(serde_json::json!({
                            "places": [{
                                "id": "ChIJ-dest",
                                "formattedAddress": "Culver City, CA",
                                "location": { "latitude": 34.0211, "longitude": -118.3965 }
                            }]
                        }))
                    }
                }),
            )
            .route(
                "/routes",
                post(|| async { (StatusCode::FORBIDDEN, "Routes API disabled") }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = MapsClient::new(Some("maps-test-key".to_string())).with_endpoints(
            format!("http://{addr}/places"),
            format!("http://{addr}/routes"),
        );

        let est = client
            .compute_commute("West Los Angeles, CA", "Culver City, CA", "DRIVE")
            .await
            .unwrap();
        assert_eq!(est.estimate_source, "places_haversine");
        assert!(est.distance_meters > 4_000 && est.distance_meters < 7_000);
        assert!(est.duration_seconds >= 60);
    }
}
