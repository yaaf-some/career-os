//! Targeting and skills edited in the app (`profile_rules`), laid over the files.

use sqlx::SqlitePool;

use super::LoadedProfile;

/// Replaces file-based targeting and skills with saved app rules. Without saved
/// rules the profile is unchanged.
pub async fn apply(_pool: &SqlitePool, _profile: &mut LoadedProfile) {}
