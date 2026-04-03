#!/bin/bash
# JackClaw E2E Runner
# Starts Hub, runs smoke test, cleans up

set -e

HUB_PORT=${HUB_PORT:-13100}
HUB_URL="http://localhost:${HUB_PORT}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Hub on port $HUB_PORT..."
HUB_PORT=$HUB_PORT node "$PROJECT_ROOT/packages/hub/dist/index.js" &
HUB_PID=$!

# Wait for Hub ready
for i in $(seq 1 20); do
  if curl -sf "$HUB_URL/health" > /dev/null 2>&1; then
    echo "Hub ready."
    break
  fi
  sleep 0.5
done

HUB_URL="$HUB_URL" bash "$PROJECT_ROOT/e2e/smoke-test.sh"
STATUS=$?

kill $HUB_PID 2>/dev/null || true
exit $STATUS
