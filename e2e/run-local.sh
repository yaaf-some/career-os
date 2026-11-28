#!/usr/bin/env bash
# Throwaway Career OS for end-to-end tests: scanner sidecar + API serving the
# built web app, with mock AI, synthetic profile data and a temporary database.
#
#   e2e/run-local.sh [port]     # default 18100; the scanner uses port + 1000
#
# Build the web app first: (cd web && npm ci && npm run build)
set -euo pipefail

PORT="${1:-18100}"
SCANNER_PORT=$((PORT + 1000))
# 8080 is the live app and 8787 the live AI bridge.
for p in "$PORT" "$SCANNER_PORT"; do
  if [[ "$p" == 8080 || "$p" == 8787 ]]; then
    echo "port $p belongs to the live instance" >&2
    exit 2
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/web/dist/index.html" ]] || { echo "build the web app first" >&2; exit 2; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/career-os-e2e.XXXXXX")"
cp -R "$ROOT/e2e/fixtures/data" "$TMP/data"

# `env -i` keeps real tokens and API keys in your shell out of the test app.
clean_env=(env -i PATH="$PATH" HOME="$HOME")
[[ -n "${CARGO_HOME:-}" ]] && clean_env+=(CARGO_HOME="$CARGO_HOME")
[[ -n "${RUSTUP_HOME:-}" ]] && clean_env+=(RUSTUP_HOME="$RUSTUP_HOME")
# Worktrees can share one build directory to save disk.
[[ -n "${CARGO_TARGET_DIR:-}" ]] && clean_env+=(CARGO_TARGET_DIR="$CARGO_TARGET_DIR")

(cd "$ROOT" && "${clean_env[@]}" cargo build -q -p career-os-api)

"${clean_env[@]}" PORT="$SCANNER_PORT" node "$ROOT/scanner/src/server.mjs" &
SCANNER_PID=$!

"${clean_env[@]}" \
  CAREER_OS_BIND="127.0.0.1:$PORT" \
  DATABASE_URL="sqlite://$TMP/e2e.db?mode=rwc" \
  CAREER_OS_DATA_DIR="$TMP/data" \
  STATIC_DIR="$ROOT/web/dist" \
  SCANNER_URL="http://127.0.0.1:$SCANNER_PORT" \
  AI_DEMO_MODE=true \
  CAREER_OS_SCHEDULER_ENABLED=false \
  "${CARGO_TARGET_DIR:-$ROOT/target}/debug/career-os-api" &
API_PID=$!

cleanup() {
  kill "$API_PID" "$SCANNER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
wait "$API_PID"
