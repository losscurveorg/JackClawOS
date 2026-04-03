/**
 * index.ts — JackClaw OpenClaw Plugin entry point.
 *
 * Uses definePluginEntry() for compatibility with OpenClaw's latest plugin SDK.
 *
 * Required openclaw.yaml config:
 *
 *   plugins:
 *     entries:
 *       jackclaw:
 *         path: /path/to/jackclaw/packages/openclaw-plugin
 *
 * Optional env vars:
 *   JACKCLAW_HUB_URL    — Hub base URL (default: http://localhost:3100)
 *   JACKCLAW_CEO_TOKEN  — JWT for CEO-level Hub API access
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { registerJackclawPlugin } from './plugin.js'

// ─── Re-exports: Heartbeat Hooks ─────────────────────────────────────────────
export type {
  SharedMemoryEntry,
  CollabInvite,
  WatchdogAlert,
  AlertSeverity,
  PendingAuthRequest,
} from './hooks/heartbeat.hook.js'
export {
  onHeartbeat,
  checkOwnerEmotionalState,
  checkPendingAuthRequests,
  checkPendingInvites,
  checkWatchdogAlerts,
} from './hooks/heartbeat.hook.js'

// ─── Re-exports: Compact Hooks ───────────────────────────────────────────────
export type { CompactResult } from './hooks/compact.hook.js'
export {
  autoCompact,
  snipCompact,
  crossNodeCompact,
} from './hooks/compact.hook.js'

// ─── Re-exports: Agent Tools ─────────────────────────────────────────────────
export type { OpenClawTool } from './agent-tool.js'
export { getJackClawTools } from './agent-tool.js'

// ─── Plugin Definition (compatible with definePluginEntry) ────────────────────

export default definePluginEntry({
  id: 'jackclaw',
  name: 'JackClaw',
  description: 'JackClaw — AI 公司组织协作层。团队汇报、节点状态、协作邀请、信任管理。',
  register(api) {
    registerJackclawPlugin(api)
  },
})
