#!/usr/bin/env bash
# Nightly SQLite backup for the career-os app container (JOB-7).
#
#   scripts/backup-db.sh            # one backup now
#
# Streams a consistent `VACUUM INTO` snapshot out of the running container
# (`career-os-api --backup-stdout`), verifies it with `PRAGMA integrity_check`,
# and keeps CAREER_OS_BACKUP_KEEP_DAYS days of files. Backups contain the
# encrypted Google tokens; they are useless without TOKEN_ENCRYPTION_KEY.
set -euo pipefail

DEST="${CAREER_OS_BACKUP_DIR:-$HOME/Backups/career-os}"
KEEP_DAYS="${CAREER_OS_BACKUP_KEEP_DAYS:-14}"
CONTAINER="${CAREER_OS_CONTAINER:-career-os-app-1}"
DOCKER="${DOCKER:-docker}"
SQLITE="${SQLITE:-sqlite3}"

mkdir -p "$DEST"
chmod 700 "$DEST"
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DEST/career-os-$stamp.db"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

"$DOCKER" exec "$CONTAINER" /app/career-os-api --backup-stdout >"$tmp"

result="$("$SQLITE" "$tmp" 'PRAGMA integrity_check;')"
if [[ "$result" != "ok" ]]; then
  echo "backup failed integrity_check: $result" >&2
  exit 1
fi
jobs="$("$SQLITE" "$tmp" 'SELECT COUNT(*) FROM jobs;')"
mv "$tmp" "$out"
trap - EXIT

find "$DEST" -name 'career-os-*.db' -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $out ($(wc -c <"$out" | tr -d ' ') bytes, $jobs jobs)"
