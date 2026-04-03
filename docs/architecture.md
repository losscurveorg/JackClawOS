# JackClaw Architecture

## Overview

JackClaw is a Hub-and-Node distributed system for multi-agent AI collaboration. The Hub is a lightweight coordinator; Nodes are autonomous agents running locally or in the cloud. All communication is E2E encrypted. Human approval is a hard gate — not a courtesy — for high-stakes operations.

---

## System Topology

```
                    ┌─────────────────────────────────────┐
                    │               HUB                    │
                    │  Port 19001  (RSA-4096 keypair)      │
                    │                                       │
                    │  ┌──────────────────────────────┐   │
                    │  │         REST API              │   │
                    │  │  /api/register  /api/nodes    │   │
                    │  │  /api/report    /api/summary  │   │
                    │  │  /api/memory/*  /api/collab/* │   │
                    │  │  /api/chat/*    /api/plan/*   │   │
                    │  │  /api/watchdog/* /api/payment │   │
                    │  │  /api/review/*  /health       │   │
                    │  └──────────────────────────────┘   │
                    │  ┌──────────────────────────────┐   │
                    │  │        WebSocket              │   │
                    │  │  /chat/ws  (realtime relay)   │   │
                    │  └──────────────────────────────┘   │
                    │                                       │
                    │  Stores:                              │
                    │  NodeRegistry · Reports · Memory      │
                    │  Chat · Watchdog · Payments           │
                    └────────┬──────────┬──────────────────┘
                             │ JWT auth │ RSA-encrypted
                    ─────────┘          └────────────────
                    │                                    │
         ┌──────────▼──────────┐           ┌────────────▼──────────┐
         │     NODE  :19000    │           │     NODE  :19000      │
         │  (RSA-2048 keypair) │           │  (RSA-2048 keypair)   │
         │                     │           │                       │
         │  OwnerMemory (L1-4) │           │  OwnerMemory (L1-4)   │
         │  TaskPlanner        │           │  TaskPlanner          │
         │  ClawChat           │           │  ClawChat             │
         │  Reporter (cron)    │           │  Reporter (cron)      │
         │  AI Client          │           │  AI Client            │
         │  Teaching Protocol  │           │  Teaching Protocol    │
         └─────────────────────┘           └───────────────────────┘
```

---

## Component Breakdown

### Hub (`@jackclaw/hub`)

The Hub is a stateful Express.js server. It never decrypts message payloads — it routes ciphertext. Its responsibilities:

- **Node registry** — maintains a list of registered nodes, their public keys, roles, and callback URLs.
- **Report aggregation** — receives daily encrypted reports and indexes metadata (timestamp, nodeId, role) without decrypting content.
- **Memory broker** — manages the org-wide L3 semantic memory and skill directory.
- **Collaboration orchestration** — handles invitations, trust scores, and session state.
- **Watchdog** — enforces monitoring policies, collects alerts, surfaces events requiring human ACK.
- **Payment compliance** — applies jurisdiction rules before routing payment requests to human approval.
- **Chat relay** — stores encrypted messages for offline delivery; WebSocket for real-time paths.
- **Review queue** — holds agent tasks that require human decision before execution.

The Hub generates a 4096-bit RSA keypair on first start. All Nodes receive `hubPublicKey` at registration and use it to wrap their AES session keys.

### Node (`@jackclaw/node`)

Each Node is an autonomous agent with its own identity, memory, and execution engine. On startup:

1. Generates (or loads) a stable 2048-bit RSA identity from `~/.jackclaw/identity.json`.
2. Registers with the Hub, receiving a JWT and the Hub's public key.
3. Starts a cron job to send encrypted daily reports (default: 08:00 local).
4. Opens a WebSocket connection to the Hub for real-time messages.
5. Starts its own Express.js server on port 19000 for direct task delivery.

Nodes run TaskPlanner before executing any non-trivial task, and consult OwnerMemory for context on every operation.

### Protocol (`@jackclaw/protocol`)

The cryptographic foundation. All inter-component communication uses this package:

```
Sender                              Receiver
  │                                    │
  │  1. Generate AES-256-GCM key+iv    │
  │  2. Encrypt payload with AES key   │
  │  3. Wrap AES key with RSA-OAEP     │
  │     (receiver's public key)        │
  │  4. Sign message with RSA-SHA256   │
  │  5. Transmit { from, to, type,     │
  │     payload, wrappedKey, iv, sig } │──────►│
  │                                    │  6. Verify signature
  │                                    │  7. Unwrap AES key with RSA private key
  │                                    │  8. Decrypt payload with AES key
```

Key types:
- `report` — Node → Hub daily report
- `task` — Hub → Node task assignment
- `chat` — Node ↔ Node / Node ↔ Human messages
- `ack` — acknowledgment

### Memory (`@jackclaw/memory`)

Four-layer architecture, each layer with a distinct scope and latency profile:

```
┌──────────────────────────────────────────────────────────┐
│  Layer       Scope        Storage     Latency   Privacy  │
├──────────────────────────────────────────────────────────┤
│  L1 Cache    Session      In-memory   <1ms      Private  │
│  L2 Store    Node         SQLite      <5ms      Private  │
│  L3 Semantic Org (opt-in) Hub index   <50ms     Public   │
│  Hub Sync    Bidirectional Hub REST   ~100ms    Per-entry │
└──────────────────────────────────────────────────────────┘
```

Memory categories: `procedural` (how-to), `declarative` (facts), `episodic` (events), `semantic` (relationships).

L1/L2 are never accessible to the Hub. L3 entries are explicitly published by the Node — the Hub stores only the metadata + content hash until the Node pushes full content. Hub Sync carries a `scope` field (`private | internal | public`) that gates visibility to other Nodes.

### Harness (`@jackclaw/harness`)

An adapter layer bridging IDE harnesses (Claude Code, Codex, Cursor, OpenCode) to JackClaw's memory and protocol. Each adapter:

- Injects OwnerMemory context into the harness session on startup.
- Writes back episodic memories after each session.
- Routes task assignments received from the Hub to the active harness.
- Provides audit trail entries for all harness operations.

### Watchdog (`@jackclaw/watchdog`)

An isolated monitoring subsystem. Its storage is separate from the Hub's main database — append-only with `chmod 444` on log files. No agent (including the Hub process itself) can mutate watchdog logs after write.

Flow:
1. An agent registers a policy: `watcherId` monitors `targetId` under specified conditions.
2. When a condition triggers, an alert is written to the append-only log.
3. The alert surfaces in the Hub's `/api/watchdog/alerts/:nodeId` endpoint.
4. A human must call `/api/watchdog/ack/:eventId` with a valid HMAC token to acknowledge.

### Payment Vault (`@jackclaw/payment-vault`)

Compliance-first payment engine. Each payment request goes through:

```
Submit → Jurisdiction check → Category check → Threshold check
           │                       │                 │
           ▼                       ▼                 ▼
        Reject if              Reject if         Auto-approve
        unknown              prohibited         if ≤ threshold
        jurisdiction          category               │
                                                     ▼
                                             Pending queue →
                                             Human approval
                                                     │
                                                     ▼
                                             Execute + audit log
```

Audit entries are cryptographically hashed (SHA-256 chaining) and written to isolated storage. No agent can modify approved/rejected records.

---

## Security Model

### Authentication Layers

| Layer | Mechanism | Used For |
|-------|-----------|----------|
| Node ↔ Hub | JWT (HMAC-SHA256) | All API calls after registration |
| Message content | RSA-OAEP + AES-256-GCM | E2E encryption of payloads |
| Message integrity | RSA-SHA256 signatures | Authenticity verification |
| Human approval | HMAC-SHA256 tokens | Payment, watchdog ACK, review resolve |

### Human Gate

The human gate is enforced at the Hub before executing any high-stakes action. Human tokens are generated out-of-band (e.g., delivered to the operator's device, never transmitted through agent channels). The Hub validates the token using HMAC-SHA256 before executing.

High-stakes actions that always require human approval:
`delete`, `remove`, `publish`, `deploy`, `payment`, `transfer`, `broadcast`, `terminate`, `shutdown`, `override`, `reset`

### Autonomy Levels

Nodes declare their autonomy level. The Hub enforces it:

| Level | Allowed Operations |
|-------|--------------------|
| L0 | Read-only; all writes require human approval |
| L1 | Query, list, ping; no mutations |
| L2 | Read + write; high-stakes blocked |
| L3 | Full access including payments and deployments |

An L3 node still cannot bypass payment compliance thresholds — those are enforced by the Hub regardless of node level.

### Isolation Boundaries

```
┌───────────────────────────────────────────────┐
│  Hub process                                  │
│  ┌─────────────────┐  ┌────────────────────┐  │
│  │  Main DB        │  │  Watchdog Store    │  │
│  │  (nodes,        │  │  (append-only,     │  │
│  │   reports,      │  │   chmod 444)       │  │
│  │   memory,       │  └────────────────────┘  │
│  │   chat)         │  ┌────────────────────┐  │
│  └─────────────────┘  │  Payment Vault     │  │
│                        │  (isolated,        │  │
│                        │   hash-chained)    │  │
│                        └────────────────────┘  │
└───────────────────────────────────────────────┘
```

Node L1/L2 memory is entirely outside the Hub boundary. The Hub never has read access to it.

---

## Data Flows

### Node Registration

```
Node                         Hub
 │  POST /api/register         │
 │  { nodeId, name, role,      │
 │    publicKey, callbackUrl } ─────►│
 │                             │  Generate JWT
 │                             │  Store in NodeRegistry
 │◄──────────────────────────── { token, hubPublicKey }
 │  Store JWT + hubPublicKey   │
 │  in ~/.jackclaw/identity    │
```

### Daily Report

```
Node                         Hub
 │  08:00 cron fires           │
 │  Generate AES-256-GCM key   │
 │  Encrypt report payload     │
 │  Wrap key with hubPublicKey │
 │  Sign with nodePrivateKey   │
 │  POST /api/report ──────────►│
 │                             │  Store encrypted blob
 │                             │  Index: nodeId, timestamp, role
 │◄────────────────────────────  { ok: true }
```

### Task Assignment

```
Hub                          Node
 │  POST <callbackUrl>/task    │
 │  { encryptedPayload,        │
 │    wrappedKey, signature } ─────►│
 │                             │  Verify hub signature
 │                             │  Unwrap AES key
 │                             │  Decrypt task
 │                             │  Run TaskPlanner
 │                             │  Execute (respecting autonomy level)
```

### Payment Flow

```
Node → POST /api/payment/submit
         │
         ▼
    Jurisdiction check (CN/EU/US/HK/SG/GLOBAL)
         │
    Category check (prohibited categories)
         │
    Threshold check
         │
    ┌────┴────────────────────┐
    │                         │
    ▼                         ▼
Auto-approve             Pending queue
(≤ threshold)            + notification
                              │
                         Human reviews
                         POST /api/payment/approve/:id
                         (Human-Token required)
                              │
                         Execute + audit entry
                         (hash-chained, immutable)
```

---

## Deployment

### Single-Machine (Development)

```
npm run dev
```

Hub on `:19001`, Node on `:19000`. Both processes share localhost. Tunnel package can expose Hub externally via Cloudflared.

### Docker Compose

```yaml
services:
  hub:
    ports: ["19001:19001"]
    volumes: ["~/.jackclaw/hub:/data/hub"]
  node:
    ports: ["19000:19000"]
    volumes: ["~/.jackclaw/node:/data/node"]
    environment:
      HUB_URL: http://hub:19001
```

### Multi-Machine

Each machine runs one Node. The Hub can run on any machine with a public URL. Nodes set `HUB_URL` to the Hub's public address. Tunnel package manages TLS termination.

---

## Package Dependency Graph

```
create-jackclaw     (scaffolding, no runtime deps)
jackclaw-sdk        (plugin development)

cli                 → protocol, memory, node (client only)
dashboard           → (browser, REST client only)
tunnel              → (standalone)

node                → protocol, memory
hub                 → protocol, watchdog, payment-vault
harness             → protocol, memory

watchdog            → (isolated, no cross-deps)
payment-vault       → protocol

openclaw-plugin     → protocol, memory
```

All packages are TypeScript, targeting ES2022, compiled to CommonJS with `tsc`. Strict mode enabled across all packages.
