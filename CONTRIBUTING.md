# Contributing to JackClaw

We welcome contributions! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/mackding/jackclaw.git
cd jackclaw
npm install
npm run build
```

## Project Structure

```
packages/
  protocol/     # Encryption & message signing
  hub/          # Central coordinator server
  node/         # Agent worker runtime
  memory/       # 4-layer memory system
  cli/          # Management CLI
  dashboard/    # Web UI
  harness/      # IDE bridge (Claude Code, Codex, Cursor)
  watchdog/     # Human oversight & alerts
  payment-vault/# Compliance payments
  tunnel/       # HTTPS tunnel (cloudflared)
  jackclaw-sdk/ # SDK for integrations
  openclaw-plugin/ # OpenClaw plugin bridge
  create-jackclaw/ # Project scaffolding
  pwa/          # Progressive web app
```

## Guidelines

1. **TypeScript only** — no `.js` files in `src/`
2. **Run `npm run build`** before submitting a PR — all packages must compile clean
3. **Keep packages independent** — minimize cross-package imports
4. **Write types first** — define interfaces in `types.ts` before implementation
5. **Security-first** — all inter-node communication must be encrypted

## Pull Requests

- Fork → branch → commit → PR
- Reference any related issues
- Keep PRs focused — one feature/fix per PR
- Include tests for new functionality

## Code of Conduct

Be respectful. Be constructive. We're building something cool together.
