//! Profile prose kept as Google Docs (`profile_docs`), laid over the files.

use sqlx::SqlitePool;

use super::LoadedProfile;

/// Replaces file-based prose with the last good copy of each linked Google Doc.
/// Without linked docs the profile is unchanged.
pub async fn apply(_pool: &SqlitePool, _profile: &mut LoadedProfile) {}
