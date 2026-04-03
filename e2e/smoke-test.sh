#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# JackClaw E2E Smoke Test
# Requires Hub already running on HUB_URL (default: http://localhost:13100)
#
# Usage:
#   HUB_URL=http://localhost:13100 ./e2e/smoke-test.sh
#   ./e2e/smoke-test.sh                 # uses default HUB_URL
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:13100}"
PASS=0
FAIL=0

# ── Colors ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; ((PASS++)) || true; }
fail() { echo -e "${RED}[✗]${NC} $*"; ((FAIL++)) || true; }
step() { echo -e "\n${CYAN}[→]${NC} $*"; }

# ── Helper: require field in JSON ───────────────────────────────────
require_field() {
  local json="$1" field="$2" desc="$3"
  if echo "$json" | grep -q "\"${field}\""; then
    ok "$desc"
  else
    fail "$desc — field '${field}' missing in: $json"
  fi
}

echo "═══════════════════════════════════════════════"
echo "  JackClaw E2E Smoke Test"
echo "  Hub: ${HUB_URL}"
echo "═══════════════════════════════════════════════"

# ── Generate RSA public key for registration ─────────────────────
TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"' EXIT

PUBKEY="$(node -e "
const { generateKeyPairSync } = require('crypto');
const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
process.stdout.write(JSON.stringify(publicKey));
")"

# ════════════════════════════════════════════════════════════════════
# Step 1: Health check
# ════════════════════════════════════════════════════════════════════
step "Step 1: Hub health check"
HEALTH=$(curl -sf "${HUB_URL}/health" 2>/dev/null || echo '{}')
require_field "$HEALTH" "status" "Hub /health returns status"

# ════════════════════════════════════════════════════════════════════
# Step 2: Register test node
# ════════════════════════════════════════════════════════════════════
step "Step 2: Register smoke-test CEO node"
REG=$(curl -sf -X POST "${HUB_URL}/api/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"nodeId\": \"smoke-test-ceo\",
    \"name\": \"Smoke Test CEO\",
    \"role\": \"ceo\",
    \"publicKey\": ${PUBKEY}
  }" 2>/dev/null || echo '{}')
require_field "$REG" "success" "Registration succeeds"
require_field "$REG" "token"   "Registration returns JWT token"

TOKEN=$(echo "$REG" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
if [[ -z "$TOKEN" || "$TOKEN" == "undefined" ]]; then
  fail "Could not extract JWT token from registration response"
  echo "Response was: $REG"
  exit 1
fi
ok "JWT token obtained"

AUTH="Authorization: Bearer ${TOKEN}"

# ════════════════════════════════════════════════════════════════════
# Step 3: Send a task / message via ClawChat
# ════════════════════════════════════════════════════════════════════
step "Step 3: Send ClawChat message to offline node"
MSG_ID="smoke-$(date +%s%N | cut -c1-16)"
SEND=$(curl -sf -X POST "${HUB_URL}/api/chat/send" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d "{
    \"id\": \"${MSG_ID}\",
    \"from\": \"smoke-test-ceo\",
    \"to\": \"smoke-offline-node\",
    \"content\": \"E2E smoke test message\"
  }" 2>/dev/null || echo '{}')
require_field "$SEND" "status" "ClawChat send returns status"

# ════════════════════════════════════════════════════════════════════
# Step 4: Verify node list
# ════════════════════════════════════════════════════════════════════
step "Step 4: List registered nodes"
NODES=$(curl -sf "${HUB_URL}/api/nodes" \
  -H "$AUTH" 2>/dev/null || echo '{}')
require_field "$NODES" "nodes"   "GET /api/nodes returns nodes array"
require_field "$NODES" "success" "GET /api/nodes returns success"

NODE_COUNT=$(echo "$NODES" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).total||0))")
ok "Node list returned ${NODE_COUNT} node(s)"

# ════════════════════════════════════════════════════════════════════
# Step 5: Check offline inbox
# ════════════════════════════════════════════════════════════════════
step "Step 5: Check offline inbox for smoke-offline-node"
INBOX=$(curl -sf "${HUB_URL}/api/chat/inbox?nodeId=smoke-offline-node" \
  -H "$AUTH" 2>/dev/null || echo '{}')
require_field "$INBOX" "messages" "Inbox returns messages array"
require_field "$INBOX" "count"    "Inbox returns count"

MSG_FOUND=$(echo "$INBOX" | node -e "
let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
  const msgs = JSON.parse(d).messages || [];
  console.log(msgs.some(m => m.id === '${MSG_ID}') ? 'yes' : 'no');
})")
if [[ "$MSG_FOUND" == "yes" ]]; then
  ok "Sent message found in offline inbox"
else
  fail "Sent message NOT found in offline inbox (id=${MSG_ID})"
fi

# ════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════"
if [[ "$FAIL" -eq 0 ]]; then
  echo -e "${GREEN}✅ All ${PASS} checks passed${NC}"
  exit 0
else
  echo -e "${RED}❌ ${FAIL} check(s) failed, ${PASS} passed${NC}"
  exit 1
fi
