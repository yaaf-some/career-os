#!/usr/bin/env bash
# Adds synthetic jobs to a running e2e instance and scores them with mock AI.
#
#   e2e/seed.sh [port]
set -euo pipefail
PORT="${1:-18100}"
[[ "$PORT" == 8080 ]] && { echo "refusing to seed the live instance" >&2; exit 2; }
BASE="http://127.0.0.1:$PORT"
post() { curl -fsS -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; echo; }
post /api/jobs/ingest @"$(dirname "$0")/fixtures/jobs.json"
post /api/ai/score-pending '{"limit":10}'
