pub mod ai;
pub mod auth;
pub mod comms;
pub mod commute;
pub mod contacts;
pub mod descriptions;
pub mod files;
pub mod health;
pub mod integrations;
pub mod job_edit;
pub mod jobs;
pub mod profile;
pub mod profile_docs;
pub mod rules;
pub mod settings;
pub mod sources;
pub mod tailor;
pub mod tracker;
pub mod triage;
pub mod workspace;

use utoipa::OpenApi;

use crate::state::AppState;

/// Declares every route module once for both the router and the API spec.
macro_rules! route_modules {
    ($($module:ident),* $(,)?) => {
        pub fn api_router() -> axum::Router<AppState> {
            axum::Router::new()$(.merge($module::router()))*
        }

        pub fn merge_docs(spec: &mut utoipa::openapi::OpenApi) {
            $(spec.merge($module::Doc::openapi());)*
        }
    };
}

route_modules!(
    ai,
    auth,
    comms,
    commute,
    contacts,
    descriptions,
    files,
    health,
    integrations,
    job_edit,
    jobs,
    profile,
    profile_docs,
    rules,
    settings,
    sources,
    tailor,
    tracker,
    triage,
    workspace,
);
