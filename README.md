# JackClaw

**A distributed multi-agent collaboration framework with human-in-the-loop oversight.**

JackClaw organizes AI agents into a coordinated mesh — each agent runs as an autonomous Node, all reporting to a central Hub. The Hub acts as the CEO's command center: it aggregates daily reports, routes tasks, brokers collaboration, and enforces compliance. Every high-stakes action (payments, deployments, irreversible operations) requires cryptographic human approval before execution.

---

## Quick Start

```bash
# Scaffold a new project
npm create jackclaw@latest my-org

# Enter project directory
cd my-org

# Start the Hub (coordinator)
jackclaw start --role hub

# In another terminal, start a Node agent
jackclaw start --role node --name "engineer-1"

# Send a message or task
jackclaw chat --to @engineer-1 --text "Summarize today's commits"
```

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Install CLI globally

```bash
npm install -g jackclaw
```

---

## Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                    HUB                       │
                         │                                               │
                         │  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
                         │  │ Registry │  │ Reports  │  │  Memory   │ │
                         │  └──────────┘  └──────────┘  └───────────┘ │
                         │  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
                         │  │ Watchdog │  │ Payment  │  │   Chat    │ │
                         │  └──────────┘  └──────────┘  └───────────┘ │
                         │                                               │
                         │            JWT + RSA-4096 Auth                │
                         └───────┬──────────┬───────────┬───────────────┘
                                 │          │           │
                    ─────────────┘          │           └─────────────
                    │                       │                         │
          ┌─────────▼────────┐   ┌──────────▼───────┐   ┌────────────▼──────┐
          │   NODE: backend  │   │  NODE: frontend  │   │   NODE: devops    │
          │                  │   │                  │   │                   │
          │  OwnerMemory     │   │  OwnerMemory     │   │  OwnerMemory      │
          │  TaskPlanner     │   │  TaskPlanner     │   │  TaskPlanner      │
          │  ClawChat        │   │  ClawChat        │   │  ClawChat         │
          │  Reporter        │   │  Reporter        │   │  Reporter         │
          └──────────────────┘   └──────────────────┘   └───────────────────┘

          ◄────────────── E2E Encrypted (RSA-2048 + AES-256-GCM) ──────────────►

                     Human Approval Gate (HMAC tokens) for:
                     payments · deployments · deletions · broadcasts
```

Every message between Hub and Nodes is end-to-end encrypted. The Hub never stores plaintext payloads. Human approval uses out-of-band HMAC-SHA256 tokens — the Hub cannot self-approve high-stakes actions.

---

## Core Modules

| Package | Role | Key Capability |
|---------|------|----------------|
| `@jackclaw/hub` | Central coordinator | Routes messages, aggregates reports, enforces policy |
| `@jackclaw/node` | Agent worker | Registers with Hub, executes tasks, sends daily reports |
| `@jackclaw/protocol` | Encryption layer | RSA + AES-GCM hybrid encryption, message signing |
| `@jackclaw/memory` | 4-layer memory | L1 cache → L2 SQLite → L3 semantic → Hub sync |
| `@jackclaw/harness` | IDE bridge | Connects Claude Code / Codex / Cursor to JackClaw |
| `@jackclaw/watchdog` | Human oversight | Monitoring policies, append-only alerts, human ACK |
| `@jackclaw/payment-vault` | Compliance payments | Multi-jurisdiction rules, auto/human thresholds |
| `@jackclaw/cli` | Management CLI | `jackclaw init/start/chat/status/nodes/invite` |
| `@jackclaw/dashboard` | Web UI | Real-time node status, reports, chat threads |
| `@jackclaw/tunnel` | HTTPS tunnel | Cloudflared or self-hosted secure tunnel |
| `create-jackclaw` | Scaffolding | `npm create jackclaw` project template |

---

## ClawChat

ClawChat is the real-time messaging layer connecting Nodes, the Hub, and humans. It supports three message types:

| Type | Sender | Purpose |
|------|--------|---------|
| `human` | Human operator | Direct instructions, approvals, overrides |
| `task` | Hub or Node | Assign work, delegate subtasks, coordinate agents |
| `ask` | Any agent | Request information, clarification, or review |

Messages flow over WebSocket (`/chat/ws`) with JWT auth. Offline Nodes receive messages on next poll via `/api/chat/inbox`. All message content is E2E encrypted — the Hub relays ciphertext without decrypting.

**Send a message from CLI:**
```bash
jackclaw chat --to @engineer-1 --type task --text "Deploy staging"
jackclaw chat --to @ceo --type ask --text "Need approval for $500 payment"
```

---

## OwnerMemory & Privacy Model

Each Node maintains its own **OwnerMemory** — a private 4-layer store:

```
L1  Hot Cache     In-memory, session-scoped, <5ms reads
L2  Persistent    SQLite on disk, node-scoped, survives restarts
L3  Semantic      Indexed for similarity search, org-wide (opt-in)
    Hub Sync      Bidirectional sync of selected memories to Hub
```

**Privacy guarantees:**
- L1/L2 are private to the Node — the Hub cannot read them.
- L3 entries are explicitly published by the Node (opt-in).
- Hub-synced memories can carry `scope: private | internal | public`.
- Memory access is governed by `OwnerMemoryAuth` — role-based ACL.

Nodes can teach each other via the **Teaching Protocol**: a structured session where one Node publishes procedural or declarative memories that another Node consumes and validates.

---

## TaskPlanner

Before executing any non-trivial task, a Node runs TaskPlanner to auto-generate an execution plan:

```
Input task  →  TaskPlanner  →  Execution Plan
                              ┌──────────────────────────────┐
                              │ steps: [                      │
                              │   { id, action, deps, est }  │
                              │   { id, action, deps, est }  │
                              │ ]                             │
                              │ parallel: [[1,2], [3], [4]]  │
                              │ totalEstMs: 4200              │
                              │ tokenBudget: 8000             │
                              │ autonomyLevel: L1             │
                              └──────────────────────────────┘
```

TaskPlanner outputs:
- **Steps** with dependency graph and time estimates
- **Parallel groups** — which steps can run concurrently
- **Token budget** allocation across steps
- **Autonomy level** — L0 (full human gating) to L3 (full auto)

Human approval is required before any step that touches L0-gated operations. The plan is submitted to the Hub's `/api/plan/estimate` endpoint for logging and review.

---

## Autonomy Levels

| Level | Label | Allowed |
|-------|-------|---------|
| L0 | Supervised | Read-only; all writes need human approval |
| L1 | Assisted | Query, list, ping; no mutations |
| L2 | Standard | Read + write; no high-stakes actions |
| L3 | Autonomous | Full access including payments and deployments |

High-stakes actions always require L0 human approval regardless of the Node's autonomy level: `delete`, `deploy`, `payment`, `transfer`, `broadcast`, `terminate`, `override`, `reset`.

---

## Development Setup

```bash
# Clone and install
git clone https://github.com/mackding/jackclaw.git
cd jackclaw
npm install

# Configure environment
cp .env.example .env
# Edit .env: set HUB_JWT_SECRET, NODE_ID, NODE_NAME, NODE_ROLE

# Build all packages
npm run build

# Run Hub + Node in development
npm run dev

# Run only the Hub
npm run dev:hub

# Run only a Node
npm run dev:node

# Run CLI in dev mode
npm run dev:cli

# Type-check all packages
npm run typecheck

# Run all tests
npm run test
```

### Docker

```bash
docker compose up
```

Hub runs on port `19001`, Node on port `19000`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUB_PORT` | `19001` | Hub HTTP port |
| `HUB_JWT_SECRET` | — | Required. JWT signing secret |
| `HUB_DATA_DIR` | `~/.jackclaw/hub` | Hub data directory |
| `HUB_PUBLIC_URL` | — | Publicly reachable Hub URL |
| `NODE_PORT` | `19000` | Node HTTP port |
| `NODE_ID` | auto | Stable node identifier |
| `NODE_NAME` | — | Human-readable node label |
| `NODE_ROLE` | — | Agent role (engineer, designer, etc.) |
| `HUB_URL` | — | Hub URL for node registration |
| `REPORT_SCHEDULE` | `0 8 * * *` | Cron for daily report |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Further Reading

- [API Reference](docs/API.md) — All Hub REST endpoints with request/response examples
- [Architecture](docs/ARCHITECTURE.md) — Deep-dive into system design and data flows
- [CHANGELOG](CHANGELOG.md) — Release history
