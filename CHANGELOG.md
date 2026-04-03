# Changelog

All notable changes to JackClaw will be documented here.

## [0.1.0] — 2026-04-03

### 🎉 Initial Release

First public release of JackClaw — Cross-Agent Collaboration Framework.

#### Core
- **Hub** — Central orchestrator with REST API + WebSocket
- **Node** — AI agent worker with auto-registration, cron reports, task execution
- **Protocol** — RSA-4096 + AES-256 encrypted messaging, JWT auth
- **ClawChat** — Real-time messaging (WebSocket + REST): DMs, threads, groups

#### LLM Gateway (`@jackclaw/llm-gateway`)
- **16 providers** out of the box (set API key → works)
- International: OpenAI, Anthropic (Claude), Google (Gemini), DeepSeek, Groq, Mistral, Together, OpenRouter, Ollama
- Chinese: 通义千问, 文心一言, 混元, 讯飞星火, Kimi, 智谱GLM (free tier!), 百川
- Auto-routing by model name prefix
- Fallback chain, cost estimation, stats tracking
- `gateway.fast()` / `.smart()` / `.local()` shortcuts

#### CLI
- `jackclaw start` — one-command Hub + Node launch
- `jackclaw start --tunnel` — instant public URL via cloudflared
- `jackclaw start --nodes 3` — multi-node parallel launch
- `jackclaw demo` — 30-second showcase (CEO + 3 AI employees)
- `jackclaw chat` — terminal ClawChat

#### Dashboard
- Real-time web UI at `http://localhost:3100`
- Live: node status, daily reports, messages
- Built-in ClawChat panel (WebSocket)
- 💰 Pending Payments with Approve/Reject buttons

#### Memory (`@jackclaw/memory`)
- 4-category memory system: feedback / user / project / reference
- 3 scopes: private / shared / teaching
- `semanticQuery()` — TF-IDF + optional LLM embedding
- `POST /api/memory/search` — HTTP semantic search

#### SDK (`@jackclaw/sdk`)
- `definePlugin()` / `defineNode()` factory
- Built-in examples: weather, translator, daily-reporter
- Mock context helpers for unit testing

#### Payment Vault
- CEO-approval workflow: submit → compliance check → approve/reject → execute
- Dashboard integration

#### Security
- All messages signed + encrypted (RSA-4096 + AES-256)
- JWT authentication for protected routes
- Human-in-loop for high-risk operations

### Stats
- 15 packages in monorepo
- 45+ E2E test assertions
- ~15,000 lines of TypeScript
