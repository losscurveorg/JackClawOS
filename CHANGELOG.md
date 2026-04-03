# Changelog

## [0.1.0] - 2026-04-03

### Added
- **Protocol**: RSA-4096 + AES-256-GCM hybrid encryption, message signing, JWT auth
- **Hub**: Central coordinator with WebSocket + REST API, node registry, report aggregation
- **Node**: Agent worker runtime with auto-registration, task execution, daily reporting
- **Memory**: 4-layer memory system (L1 cache → L2 SQLite → L3 semantic → Hub sync)
  - Zero-config collaboration sessions (share → end)
  - Skill transfer protocol (findExpert → learnFrom)
  - Teaching memory isolation with discard/archive/snapshot modes
- **CLI**: `jackclaw init/start/chat/status/nodes/invite` commands
- **Dashboard**: Real-time web UI for node status, reports, and chat threads
- **Harness**: IDE bridge for Claude Code, Codex, and Cursor integration
- **Watchdog**: Human oversight with monitoring policies and append-only alerts
- **Payment Vault**: Multi-jurisdiction compliance payments with auto/human thresholds
- **Tunnel**: HTTPS tunnel via cloudflared for public node access
- **OpenClaw Plugin**: Bridge to OpenClaw ecosystem
- **SDK**: TypeScript SDK for external integrations
- **PWA**: Progressive web app for mobile access
- **Create JackClaw**: `npm create jackclaw` project scaffolding
