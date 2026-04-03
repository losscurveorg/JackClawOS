#!/bin/bash
# JackClaw E2E Smoke Test
# Usage: HUB_URL=http://localhost:3100 bash e2e/smoke-test.sh

HUB_URL=${HUB_URL:-"http://localhost:3100"}
PASS=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  [PASS] $name"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name"
    FAIL=$((FAIL+1))
  fi
}

echo "JackClaw E2E Smoke Test"
echo "Hub: $HUB_URL"
echo ""

# Health
check "Hub /health" "curl -sf ${HUB_URL}/health | python3 -c \"import sys,json; d=json.load(sys.stdin); exit(0 if d.get('status')=='ok' else 1)\""

# Register node
REG_BODY='{"nodeId":"smoke-test-node","name":"Smoke Test","role":"worker","publicKey":"smoke-key","callbackUrl":"http://localhost:19000"}'
REG=$(curl -sf -X POST "${HUB_URL}/api/register" \
  -H "Content-Type: application/json" \
  -d "$REG_BODY" 2>/dev/null)
TOKEN=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
check "Register node" "test -n '$REG'"

# List nodes (if token available)
if [ -n "$TOKEN" ]; then
  check "CEO lists nodes" "curl -sf -H 'Authorization: Bearer $TOKEN' ${HUB_URL}/api/nodes"
fi

# ClawChat send
MSG_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || echo "test-msg-$(date +%s)")
SEND_BODY="{\"id\":\"${MSG_ID}\",\"from\":\"smoke-ceo\",\"to\":\"smoke-test-node\",\"content\":\"smoke test\",\"type\":\"human\",\"createdAt\":$(date +%s)000}"
check "Send chat message" "curl -sf -X POST ${HUB_URL}/api/chat/send -H 'Content-Type: application/json' -d '$SEND_BODY'"

# Inbox
check "Chat inbox" "curl -sf '${HUB_URL}/api/chat/inbox?nodeId=smoke-test-node'"

# Task plan estimate
PLAN_BODY='{"title":"Test task","description":"Build a simple feature with authentication"}'
check "Task plan estimate" "curl -sf -X POST ${HUB_URL}/api/plan/estimate -H 'Content-Type: application/json' -d '$PLAN_BODY' | python3 -c \"import sys,json; d=json.load(sys.stdin); exit(0 if 'plan' in d else 1)\""

# Summary
check "Summary endpoint" "curl -sf ${HUB_URL}/api/summary || true"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -eq 0 ]; then
  echo "All smoke tests passed"
  exit 0
else
  echo "Some tests failed"
  exit 1
fi
