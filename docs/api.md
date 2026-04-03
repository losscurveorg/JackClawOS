# JackClaw Hub API Reference

Base URL: `http://localhost:19001` (or your `HUB_PUBLIC_URL`)

## Authentication

Most endpoints require a JWT Bearer token obtained during node registration.

```
Authorization: Bearer <jwt>
```

Human-approval endpoints use a separate HMAC-SHA256 token:

```
Authorization: Human <hmac-token>
```

Public endpoints (registration, health) require no auth.

---

## Node Registration

### POST /api/register

Register a new Node with the Hub. Returns a JWT and the Hub's RSA public key for E2E encryption.

**Auth:** None

**Request:**
```json
{
  "nodeId": "node-abc123",
  "name": "engineer-1",
  "role": "backend-engineer",
  "publicKey": "<RSA-2048 public key PEM>",
  "callbackUrl": "https://node.example.com"
}
```

**Response `200`:**
```json
{
  "ok": true,
  "token": "<JWT>",
  "hubPublicKey": "<RSA-4096 public key PEM>",
  "nodeId": "node-abc123"
}
```

---

## Reports

### POST /api/report

Node submits its encrypted daily report to the Hub.

**Auth:** JWT

**Request:**
```json
{
  "nodeId": "node-abc123",
  "encryptedPayload": "<base64 AES-GCM ciphertext>",
  "signature": "<RSA-SHA256 hex signature>"
}
```

**Response `200`:**
```json
{ "ok": true, "receivedAt": "2026-04-03T08:00:00.000Z" }
```

---

### GET /api/nodes

List all registered nodes.

**Auth:** JWT (CEO role)

**Response `200`:**
```json
{
  "nodes": [
    {
      "nodeId": "node-abc123",
      "name": "engineer-1",
      "role": "backend-engineer",
      "registeredAt": "2026-04-01T09:00:00.000Z",
      "lastSeen": "2026-04-03T08:01:00.000Z",
      "callbackUrl": "https://node.example.com"
    }
  ]
}
```

---

### GET /api/summary

Aggregated daily summary grouped by node role.

**Auth:** JWT

**Query params:** `date` (ISO date string, default: today)

**Response `200`:**
```json
{
  "date": "2026-04-03",
  "byRole": {
    "backend-engineer": { "nodes": ["engineer-1"], "reportCount": 1 }
  }
}
```

---

## Memory

### GET /api/memory/org

Get the org-wide L3 memory list (opt-in published entries only).

**Auth:** JWT

**Response `200`:**
```json
{
  "entries": [
    {
      "id": "mem-001",
      "type": "procedural",
      "scope": "internal",
      "content": "Deploy flow: PR → staging → approval → prod",
      "publishedBy": "node-abc123",
      "publishedAt": "2026-04-02T10:00:00.000Z"
    }
  ]
}
```

---

### POST /api/memory/broadcast

Broadcast a memory entry to the org.

**Auth:** JWT

**Request:**
```json
{
  "type": "declarative",
  "scope": "public",
  "content": "API rate limit is 1000 req/min per key",
  "tags": ["api", "limits"]
}
```

**Response `200`:**
```json
{ "ok": true, "id": "mem-002" }
```

---

### POST /api/memory/skills

Register skills for the calling Node.

**Auth:** JWT

**Request:**
```json
{
  "nodeId": "node-abc123",
  "skills": ["typescript", "postgres", "docker"]
}
```

**Response `200`:**
```json
{ "ok": true }
```

---

### GET /api/memory/experts

Find nodes with a given skill.

**Auth:** JWT

**Query params:** `skill` (required)

**Response `200`:**
```json
{
  "experts": [
    { "nodeId": "node-abc123", "name": "engineer-1", "skills": ["typescript", "postgres"] }
  ]
}
```

---

### POST /api/memory/collab/init

Start a collaborative memory session.

**Auth:** JWT

**Request:**
```json
{
  "participants": ["node-abc123", "node-def456"],
  "intent": "teach",
  "topic": "deployment-runbook"
}
```

**Response `200`:**
```json
{ "ok": true, "sessionId": "collab-789" }
```

---

### POST /api/memory/collab/:id/sync

Sync an entry into an active collaborative session.

**Auth:** JWT

**Request:**
```json
{ "type": "procedural", "content": "Step 1: run migrations. Step 2: deploy." }
```

**Response `200`:**
```json
{ "ok": true }
```

---

### POST /api/memory/collab/:id/end

End a collaborative session and retrieve accumulated entries.

**Auth:** JWT

**Response `200`:**
```json
{
  "ok": true,
  "entries": [
    { "type": "procedural", "content": "Step 1: run migrations. Step 2: deploy." }
  ]
}
```

---

## Agent Directory

### POST /api/directory/register

Register an `@handle` for a Node.

**Auth:** JWT

**Request:**
```json
{ "nodeId": "node-abc123", "handle": "engineer-1", "public": true }
```

**Response `200`:**
```json
{ "ok": true, "handle": "@engineer-1" }
```

---

### GET /api/directory/lookup/:handle

Look up a Node by its `@handle`.

**Auth:** JWT

**Response `200`:**
```json
{
  "nodeId": "node-abc123",
  "name": "engineer-1",
  "role": "backend-engineer",
  "callbackUrl": "https://node.example.com"
}
```

**Response `404`:** `{ "error": "handle not found" }`

---

### GET /api/directory/list

List all public agents.

**Auth:** JWT

**Response `200`:**
```json
{
  "agents": [
    { "handle": "@engineer-1", "nodeId": "node-abc123", "role": "backend-engineer" }
  ]
}
```

---

## Collaboration

### POST /api/collab/invite

Send a collaboration invitation to another Node.

**Auth:** JWT

**Request:**
```json
{
  "from": "node-abc123",
  "to": "node-def456",
  "topic": "API design review",
  "message": "Need a second pair of eyes on the auth flow"
}
```

**Response `200`:**
```json
{ "ok": true, "inviteId": "inv-001" }
```

---

### POST /api/collab/respond

Accept, decline, or conditionally respond to an invitation.

**Auth:** JWT

**Request:**
```json
{ "inviteId": "inv-001", "response": "accept", "message": "Happy to help" }
```

`response`: `accept` | `decline` | `conditional`

**Response `200`:**
```json
{ "ok": true, "sessionId": "sess-101" }
```

---

### PATCH /api/collab/sessions/:sessionId

Pause, resume, or end a collaboration session.

**Auth:** JWT

**Request:** `{ "action": "pause" }`  — values: `pause` | `resume` | `end`

**Response `200`:** `{ "ok": true }`

---

### GET /api/collab/sessions

List all active collaboration sessions.

**Auth:** JWT

**Response `200`:**
```json
{
  "sessions": [
    {
      "sessionId": "sess-101",
      "participants": ["node-abc123", "node-def456"],
      "topic": "API design review",
      "status": "active",
      "startedAt": "2026-04-03T10:00:00.000Z"
    }
  ]
}
```

---

### GET /api/collab/trust/:from/:to

Check the trust relationship between two nodes.

**Auth:** JWT

**Response `200`:**
```json
{ "from": "node-abc123", "to": "node-def456", "trustScore": 0.82, "bidirectional": true }
```

---

## Watchdog

### POST /api/watchdog/policy

Add a monitoring policy.

**Auth:** JWT

**Request:**
```json
{
  "watcherId": "node-abc123",
  "targetId": "node-def456",
  "conditions": ["payment > 100", "action = deploy"],
  "alertSeverity": "high"
}
```

**Response `200`:** `{ "ok": true, "policyId": "pol-001" }`

---

### GET /api/watchdog/alerts/:nodeId

Query alerts for a node.

**Auth:** JWT

**Query params:** `since` (ISO date), `severity` (`low` | `medium` | `high` | `critical`)

**Response `200`:**
```json
{
  "alerts": [
    {
      "eventId": "evt-001",
      "nodeId": "node-def456",
      "condition": "payment > 100",
      "severity": "high",
      "triggeredAt": "2026-04-03T11:00:00.000Z",
      "acknowledged": false
    }
  ]
}
```

---

### POST /api/watchdog/ack/:eventId

Human acknowledges a watchdog alert.

**Auth:** Human-Token

**Request:** `{ "note": "Reviewed and approved" }`

**Response `200`:** `{ "ok": true, "acknowledgedAt": "2026-04-03T11:05:00.000Z" }`

---

### GET /api/watchdog/snapshot/:nodeId

Get the latest state snapshot of a node.

**Auth:** JWT

**Response `200`:**
```json
{
  "nodeId": "node-def456",
  "snapshotAt": "2026-04-03T11:00:00.000Z",
  "state": { "autonomyLevel": "L2", "activeTaskCount": 3, "memoryUsage": "48MB" }
}
```

---

## Payments

### POST /api/payment/submit

Agent submits a payment request for compliance review.

**Auth:** JWT

**Request:**
```json
{
  "nodeId": "node-abc123",
  "amount": 250,
  "currency": "USD",
  "jurisdiction": "US",
  "recipient": "vendor-xyz",
  "description": "API usage fees",
  "category": "software"
}
```

**Response `200`:**
```json
{
  "ok": true,
  "paymentId": "pay-001",
  "status": "pending",
  "requiresHumanApproval": true,
  "reason": "amount exceeds auto-approve threshold"
}
```

---

### GET /api/payment/pending

Query payments awaiting human approval.

**Auth:** JWT

**Response `200`:**
```json
{
  "payments": [
    {
      "paymentId": "pay-001",
      "nodeId": "node-abc123",
      "amount": 250,
      "currency": "USD",
      "jurisdiction": "US",
      "status": "pending",
      "submittedAt": "2026-04-03T09:00:00.000Z"
    }
  ]
}
```

---

### POST /api/payment/approve/:id

Human approves a pending payment.

**Auth:** Human-Token

**Request:** `{ "note": "Approved after invoice verification" }`

**Response `200`:** `{ "ok": true, "status": "approved" }`

---

### POST /api/payment/reject/:id

Human rejects a pending payment.

**Auth:** Human-Token

**Request:** `{ "reason": "Duplicate request" }`

**Response `200`:** `{ "ok": true, "status": "rejected" }`

---

### GET /api/payment/audit/:nodeId

Read-only audit log of all payments for a node.

**Auth:** JWT

**Response `200`:**
```json
{
  "payments": [
    {
      "paymentId": "pay-001",
      "amount": 250,
      "status": "approved",
      "approvedAt": "2026-04-03T09:10:00.000Z",
      "auditHash": "sha256:abc..."
    }
  ]
}
```

---

## Human Review

### POST /api/review/request

Agent submits a task for human review before proceeding.

**Auth:** JWT

**Request:**
```json
{
  "nodeId": "node-abc123",
  "taskId": "task-501",
  "action": "deploy",
  "context": "About to deploy v2.1.0 to production",
  "urgency": "high"
}
```

**Response `200`:** `{ "ok": true, "requestId": "rev-001" }`

---

### GET /api/review/pending

Query pending human review requests.

**Auth:** JWT

**Response `200`:**
```json
{
  "requests": [
    {
      "requestId": "rev-001",
      "nodeId": "node-abc123",
      "action": "deploy",
      "context": "About to deploy v2.1.0 to production",
      "urgency": "high",
      "submittedAt": "2026-04-03T14:00:00.000Z"
    }
  ]
}
```

---

### POST /api/review/resolve/:requestId

Human resolves a pending review.

**Auth:** Human-Token

**Request:**
```json
{ "decision": "approve", "note": "Staging checks passed, proceed" }
```

`decision`: `approve` | `reject` | `defer`

**Response `200`:** `{ "ok": true, "resolvedAt": "2026-04-03T14:05:00.000Z" }`

---

## Task Planning

### POST /api/plan/estimate

Submit a task for automatic execution plan generation.

**Auth:** JWT

**Request:**
```json
{
  "nodeId": "node-abc123",
  "task": "Migrate user table to new schema",
  "context": { "dbSize": "50GB", "downtime": "allowed" }
}
```

**Response `200`:**
```json
{
  "ok": true,
  "plan": {
    "steps": [
      { "id": 1, "action": "backup database", "deps": [], "estMs": 300000 },
      { "id": 2, "action": "run migration script", "deps": [1], "estMs": 120000 },
      { "id": 3, "action": "verify data integrity", "deps": [2], "estMs": 30000 }
    ],
    "parallel": [[1], [2], [3]],
    "totalEstMs": 450000,
    "tokenBudget": 12000,
    "autonomyLevel": "L1",
    "requiresHumanApproval": true
  }
}
```

---

## Chat

### POST /api/chat/send

Send a message via Hub relay (supports offline delivery).

**Auth:** JWT

**Request:**
```json
{
  "from": "node-abc123",
  "to": "node-def456",
  "type": "task",
  "content": "<E2E encrypted ciphertext>",
  "threadId": "thread-001"
}
```

`type`: `human` | `task` | `ask`

**Response `200`:** `{ "ok": true, "messageId": "msg-001", "deliveredAt": "..." }`

---

### GET /api/chat/inbox

Pull offline messages for the calling Node.

**Auth:** JWT

**Query params:** `nodeId` (required)

**Response `200`:**
```json
{
  "messages": [
    { "messageId": "msg-002", "from": "node-def456", "type": "ask", "content": "<ciphertext>", "sentAt": "..." }
  ]
}
```

---

### GET /api/chat/threads

Get conversation thread list for a Node.

**Auth:** JWT

**Query params:** `nodeId` (required)

**Response `200`:**
```json
{
  "threads": [
    {
      "threadId": "thread-001",
      "participants": ["node-abc123", "node-def456"],
      "lastMessageAt": "2026-04-03T10:00:00.000Z",
      "messageCount": 12
    }
  ]
}
```

---

### GET /api/chat/thread/:id

Get full message history for a thread.

**Auth:** JWT

**Response `200`:**
```json
{
  "threadId": "thread-001",
  "messages": [
    { "messageId": "msg-001", "from": "node-abc123", "type": "task", "content": "<ciphertext>", "sentAt": "..." }
  ]
}
```

---

### POST /api/chat/thread

Create a new conversation thread.

**Auth:** JWT

**Request:** `{ "participants": ["node-abc123", "node-def456"], "topic": "Sprint planning" }`

**Response `200`:** `{ "ok": true, "threadId": "thread-002" }`

---

## WebSocket

### WS /chat/ws

Real-time chat. Auth via query param.

**Connect:** `ws://localhost:19001/chat/ws?nodeId=node-abc123`

**Incoming:**
```json
{ "messageId": "msg-003", "from": "node-def456", "type": "task", "content": "<ciphertext>", "sentAt": "..." }
```

**Outgoing:**
```json
{ "to": "node-def456", "type": "ask", "content": "<ciphertext>", "threadId": "thread-001" }
```

---

## Health

### GET /health

**Auth:** None

**Response `200`:** `{ "ok": true, "version": "0.2.0", "uptime": 3600 }`

---

## Error Responses

```json
{ "error": "unauthorized" }                         // 401
{ "error": "forbidden" }                            // 403
{ "error": "not found" }                            // 404
{ "error": "validation failed", "details": [...] }  // 400
{ "error": "internal server error" }                // 500
```

---

## Jurisdiction Payment Thresholds

| Jurisdiction | Auto-Approve ≤ | Requires Human > | Max Daily |
|--------------|---------------|-----------------|-----------|
| US | $500 | $500 | $5,000 |
| EU | $30 | $30 | $1,000 |
| HK | $200 | $1,300 | $6,500 |
| SG | $150 | $750 | $3,750 |
| CN | $137 | $685 | $1,370 |
| GLOBAL | $10 | $10 | $100 |

Prohibited categories (always rejected): `gambling`, `crypto`, `adult`, `weapons`.
