/**
 * plugin.ts — JackClaw OpenClaw Plugin main body.
 *
 * Implements:
 *   1. Slash-commands (/jackclaw status, /jackclaw report, /jackclaw help)
 *   2. Natural-language intercept via inbound_claim hook
 *   3. Background service: polls Hub every 60 s and pushes new-report
 *      notifications to the CEO's configured delivery channel.
 *   4. Team AutoReply: each configured team node (cto, cmo, …) registers its
 *      own ClawChat account, listens for inbound messages, and replies via
 *      the OpenClaw Gateway LLM.
 */

import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from 'openclaw/plugin-sdk/plugin-entry'
import { JACKCLAW_COMMANDS, matchNaturalLanguage, handleReport, handleStatus } from './commands.js'
import {
  fetchSummary,
  hubHealthCheck,
  formatSummary,
  formatNodeStatus,
  fetchNodes,
  ensureClawChatAuth,
  setHubUrl,
} from './bridge.js'
import { PluginChatClient, initPluginChatClient, getPluginChatClient } from './chat-bridge.js'

// ─── Team node types ───────────────────────────────────────────────────────────

interface TeamNodeConfig {
  /** ClawChat handle for this node, e.g. "cto" */
  id: string
  /** System prompt injected into every LLM call */
  systemPrompt: string
  /** Model alias passed to OpenClaw Gateway, e.g. "gpt-4o" or "claude-sonnet-4" */
  model: string
}

// ─── AutoReplyHandler ─────────────────────────────────────────────────────────

/**
 * Calls the OpenClaw Gateway (OpenAI-compatible) to generate a reply for an
 * inbound ClawChat message, then sends the result back via ClawChat.
 */
class AutoReplyHandler {
  private readonly systemPrompt: string
  private readonly model: string
  private readonly gatewayUrl: string

  constructor(config: TeamNodeConfig, gatewayUrl: string) {
    this.systemPrompt = config.systemPrompt
    this.model = config.model
    this.gatewayUrl = gatewayUrl.replace(/\/+$/, '')
  }

  /**
   * Send `content` (from `from`) to the LLM and return the reply text.
   * Throws on network or model error.
   */
  async call(from: string, content: string): Promise<string> {
    const res = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: `@${from}: ${content}` },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      throw new Error(`OpenClaw Gateway error ${res.status} (model: ${this.model})`)
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? '（无响应）'
  }
}

// ─── Per-node ClawChat credential management ──────────────────────────────────

/** Resolve credentials for a virtual team node, storing them separately from
 *  the operator account so each node has its own ClawChat identity. */
async function ensureTeamNodeAuth(
  hubUrl: string,
  nodeId: string,
): Promise<{ handle: string; token: string }> {
  const { default: os } = await import('os')
  const { default: path } = await import('path')
  const { default: fs } = await import('fs/promises')
  const { randomBytes } = await import('crypto')

  const authDir  = path.join(os.homedir(), '.jackclaw')
  const authFile = path.join(authDir, `team-${nodeId}.json`)

  type StoredCreds = { handle: string; password: string; token: string }

  const isExpired = (token: string): boolean => {
    try {
      const parts = token.split('.')
      if (parts.length < 2) return true
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64url').toString('utf8'),
      ) as { exp?: number }
      if (!payload.exp) return false
      return Date.now() / 1000 > payload.exp - 60
    } catch { return true }
  }

  let existing: StoredCreds | null = null
  try {
    const raw  = await fs.readFile(authFile, 'utf8')
    const data = JSON.parse(raw) as Partial<StoredCreds>
    if (data.handle && data.password && data.token) existing = data as StoredCreds
  } catch { /* file absent */ }

  if (existing) {
    if (!isExpired(existing.token)) {
      return { handle: existing.handle, token: existing.token }
    }
    // Token expired — re-login silently
    try {
      const loginRes = await fetch(`${hubUrl}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ handle: existing.handle, password: existing.password }),
        signal:  AbortSignal.timeout(10_000),
      })
      if (loginRes.ok) {
        const loginData = await loginRes.json() as { token?: string }
        if (loginData.token) {
          const updated: StoredCreds = { ...existing, token: loginData.token }
          await fs.writeFile(authFile, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600 })
          return { handle: existing.handle, token: loginData.token }
        }
      }
    } catch { /* fall through to re-register */ }
  }

  // Register a fresh account for this team node
  const handle   = nodeId
  const password = randomBytes(32).toString('hex')

  const regRes = await fetch(`${hubUrl}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ handle, password, displayName: handle.toUpperCase() }),
    signal:  AbortSignal.timeout(10_000),
  })
  if (!regRes.ok) {
    throw new Error(`Team node "${nodeId}" registration failed: ${regRes.status} ${regRes.statusText}`)
  }
  const regData = await regRes.json() as { token?: string }
  if (!regData.token) throw new Error(`Team node "${nodeId}" registration: no token returned`)

  await fs.mkdir(authDir, { recursive: true })
  await fs.writeFile(
    authFile,
    JSON.stringify({ handle, password, token: regData.token }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )

  return { handle, token: regData.token }
}

/** Minimal delivery helper — calls the Gateway deliver endpoint if configured. */
async function pushNotification(text: string, ctx: OpenClawPluginServiceContext): Promise<void> {
  const cfg = ctx.config as Record<string, unknown>
  const pluginCfg = (cfg['plugins'] as Record<string, unknown> | undefined)?.['jackclaw'] as
    | Record<string, unknown>
    | undefined

  const deliveryTo = (pluginCfg?.['notifyTo'] as string | undefined) ?? ''
  const deliveryChannel = (pluginCfg?.['notifyChannel'] as string | undefined) ?? ''

  if (!deliveryTo || !deliveryChannel) {
    ctx.logger.info('[jackclaw] no notifyTo/notifyChannel configured — skipping push')
    return
  }

  // Use OpenClaw's runtime deliver API when available
  const runtime = (ctx as unknown as { runtime?: { deliver?: (params: unknown) => Promise<void> } }).runtime
  if (runtime?.deliver) {
    try {
      await runtime.deliver({ to: deliveryTo, channel: deliveryChannel, text })
      ctx.logger.info(`[jackclaw] pushed notification to ${deliveryTo} via ${deliveryChannel}`)
    } catch (err) {
      ctx.logger.warn(`[jackclaw] deliver failed: ${String(err)}`)
    }
  } else {
    // Fallback: log to console for manual piping
    ctx.logger.info(`[jackclaw] notification (${deliveryChannel} → ${deliveryTo}):\n${text}`)
  }
}

/** Build the background polling service. */
function buildJackclawService(
  hubUrl: string,
  autoRegister: boolean,
  teamNodes: TeamNodeConfig[],
  gatewayUrl: string,
): OpenClawPluginService {
  let stopped = false
  let lastReportingNodes = 0
  // Dedup window: message id → arrival timestamp (purged after 60 s)
  const recentMessageIds = new Map<string, number>()
  // Team node WS clients — stopped alongside the service
  const teamClients: PluginChatClient[] = []

  return {
    id: 'jackclaw-hub-poller',
    async start(ctx: OpenClawPluginServiceContext) {
      ctx.logger.info('[jackclaw] Hub poller started (interval: 60s)')
      stopped = false

      // ── Apply Hub URL from config ─────────────────────────────────────────
      setHubUrl(hubUrl)
      ctx.logger.info(`[jackclaw] Hub URL: ${hubUrl}`)

      // ── Auto-register / refresh ClawChat Hub account on first load ──────
      let chatToken = ''
      if (autoRegister) {
        try {
          // Prefer OpenClaw user identity when available, fall back to random handle.
          const cfg = ctx.config as Record<string, unknown>
          const identity = (cfg['user'] as Record<string, unknown> | undefined)?.['handle'] as string | undefined
          const { handle, token, isNew } = await ensureClawChatAuth(hubUrl, identity)
          chatToken = token
          ctx.logger.info(`[jackclaw] ClawChat auth ready (handle: ${handle})`)

          // On first registration, send a welcome message via pushNotification
          if (isNew) {
            const welcomeText =
              `🦞 ClawChat 已就绪！你的账号: @${handle}\n` +
              `使用 /chat send @someone 消息 开始聊天`
            await pushNotification(welcomeText, ctx)
          }
        } catch (err) {
          // Non-fatal: plugin still works without ClawChat registration.
          ctx.logger.warn(`[jackclaw] ClawChat auto-register failed: ${String(err)}`)
        }
      } else {
        ctx.logger.info('[jackclaw] autoRegister disabled — skipping ClawChat registration')
      }

      // ── Start WebSocket chat client ───────────────────────────────────────
      if (chatToken) {
        const chatClient = initPluginChatClient(hubUrl, chatToken)

        // Push inbound ClawChat messages to the OpenClaw delivery channel
        chatClient.onMessage((raw) => {
          const msg = raw as { id?: string; from?: string; to?: string; content?: string; type?: string }
          const id = typeof msg.id === 'string' ? msg.id : ''
          if (!id) return

          // 60-second dedup window
          const now = Date.now()
          if (recentMessageIds.has(id)) return
          recentMessageIds.set(id, now)
          // Purge expired entries
          for (const [k, ts] of recentMessageIds) {
            if (now - ts > 60_000) recentMessageIds.delete(k)
          }

          const from = typeof msg.from === 'string' ? msg.from : 'unknown'
          const content = typeof msg.content === 'string' ? msg.content : ''
          const icon = msg.type === 'task' ? '🔧' : '💬'
          const text = `${icon} ClawChat | @${from}: ${content}`

          void pushNotification(text, ctx)
        })

        chatClient.connect()
        ctx.logger.info('[jackclaw] PluginChatClient connected')
      }

      // ── Initialize team node AutoReply clients ────────────────────────────
      for (const nodeConfig of teamNodes) {
        try {
          const { handle, token } = await ensureTeamNodeAuth(hubUrl, nodeConfig.id)
          ctx.logger.info(`[jackclaw] Team node ready: @${handle} (model: ${nodeConfig.model})`)

          const handler = new AutoReplyHandler(nodeConfig, gatewayUrl)
          const nodeClient = new PluginChatClient(hubUrl, token)
          teamClients.push(nodeClient)

          nodeClient.onMessage((raw) => {
            const msg = raw as { id?: string; from?: string; to?: string; content?: string }
            const msgId = typeof msg.id === 'string' ? msg.id : ''
            const from  = typeof msg.from === 'string' ? msg.from : ''
            const content = typeof msg.content === 'string' ? msg.content : ''
            // Only process messages addressed to this node
            if (typeof msg.to !== 'string' || msg.to !== handle) return
            if (!from || !content || !msgId) return

            // Dedup
            const now = Date.now()
            if (recentMessageIds.has(msgId)) return
            recentMessageIds.set(msgId, now)
            for (const [k, ts] of recentMessageIds) {
              if (now - ts > 60_000) recentMessageIds.delete(k)
            }

            ctx.logger.info(`[jackclaw] @${handle} ← @${from}: ${content.slice(0, 60)}`)

            // Trigger AutoReplyHandler, send reply back via ClawChat
            void (async () => {
              try {
                const reply = await handler.call(from, content)
                nodeClient.send(from, reply, 'human')
                ctx.logger.info(`[jackclaw] @${handle} → @${from}: ${reply.slice(0, 60)}`)

                // Also push the exchange to the operator's notification channel
                void pushNotification(
                  `🤖 @${handle} → @${from}\n${reply}`,
                  ctx,
                )
              } catch (err) {
                ctx.logger.warn(`[jackclaw] AutoReply error (@${handle}): ${String(err)}`)
              }
            })()
          })

          nodeClient.connect()
          ctx.logger.info(`[jackclaw] Team node @${handle} WS connected`)
        } catch (err) {
          ctx.logger.warn(`[jackclaw] Failed to init team node "${nodeConfig.id}": ${String(err)}`)
        }
      }

      const poll = async () => {
        if (stopped) return

        try {
          const alive = await hubHealthCheck()
          if (!alive) {
            ctx.logger.info('[jackclaw] Hub unreachable, skipping poll')
            return
          }

          const summary = await fetchSummary()
          const currentCount = summary.reportingNodes

          // Notify CEO when new reports arrive
          if (currentCount > lastReportingNodes) {
            const newCount = currentCount - lastReportingNodes
            const text =
              `🔔 JackClaw 新汇报\n有 ${newCount} 个节点提交了新汇报。\n\n` +
              formatSummary(summary)
            await pushNotification(text, ctx)
          }

          lastReportingNodes = currentCount
        } catch (err) {
          ctx.logger.warn(`[jackclaw] poll error: ${String(err)}`)
        }
      }

      // Initial poll after startup
      setTimeout(poll, 5000)

      // Recurring poll
      const interval = setInterval(poll, 60_000)

      // Store interval so stop() can clear it
      ;(this as unknown as { _interval?: ReturnType<typeof setInterval> })._interval = interval
    },
    async stop(ctx: OpenClawPluginServiceContext) {
      stopped = true
      const self = this as unknown as { _interval?: ReturnType<typeof setInterval> }
      if (self._interval) {
        clearInterval(self._interval)
        delete self._interval
      }
      // Stop WebSocket chat client
      const chatClient = getPluginChatClient()
      if (chatClient) {
        chatClient.stop()
        ctx.logger.info('[jackclaw] PluginChatClient stopped')
      }
      // Stop team node clients
      for (const tc of teamClients) tc.stop()
      if (teamClients.length > 0) {
        ctx.logger.info(`[jackclaw] Stopped ${teamClients.length} team node client(s)`)
        teamClients.length = 0
      }
      ctx.logger.info('[jackclaw] Hub poller stopped')
    },
  }
}

/** Register the JackClaw plugin with OpenClaw. */
export function registerJackclawPlugin(api: OpenClawPluginApi): void {
  // ── Resolve plugin config (openclaw.yaml → env var → default) ──────────
  const globalCfg = api.config as Record<string, unknown>
  // Support both: plugins.entries.jackclaw.config and plugins.jackclaw.config
  const entriesCfg = (globalCfg['plugins'] as Record<string, unknown> | undefined)?.['entries'] as
    | Record<string, unknown>
    | undefined
  const pluginSection =
    (entriesCfg?.['jackclaw'] as Record<string, unknown> | undefined) ??
    ((globalCfg['plugins'] as Record<string, unknown> | undefined)?.['jackclaw'] as
      | Record<string, unknown>
      | undefined)
  const pluginConfig = (pluginSection?.['config'] as Record<string, unknown> | undefined) ?? {}

  const hubUrl: string =
    (pluginConfig['hubUrl'] as string | undefined) ??
    process.env['JACKCLAW_HUB_URL'] ??
    'https://hub.jackclaw.ai'

  // autoRegister defaults to true; set to false in config to skip registration
  const autoRegister: boolean = pluginConfig['autoRegister'] !== false

  // Team node configs: each entry creates a dedicated ClawChat agent + LLM handler
  const teamNodes: TeamNodeConfig[] = Array.isArray(pluginConfig['team'])
    ? (pluginConfig['team'] as Array<Record<string, unknown>>).map((n) => ({
        id:           String(n['id'] ?? ''),
        systemPrompt: String(n['systemPrompt'] ?? `你是 ${String(n['id'] ?? 'agent')}`),
        model:        String(n['model'] ?? 'claude-sonnet-4'),
      })).filter((n) => n.id.length > 0)
    : []

  // OpenClaw Gateway URL — default to localhost:5337
  const gatewayUrl: string =
    (pluginConfig['gatewayUrl'] as string | undefined) ??
    process.env['OPENCLAW_GATEWAY_URL'] ??
    'http://localhost:5337'

  api.logger.info(
    `[jackclaw] config — hubUrl: ${hubUrl}, autoRegister: ${autoRegister}, ` +
    `teamNodes: [${teamNodes.map((n) => n.id).join(', ')}], gateway: ${gatewayUrl}`,
  )

  // 1. Register slash commands
  for (const cmd of JACKCLAW_COMMANDS) {
    api.registerCommand(cmd)
  }

  // 2. Natural-language intercept via inbound_claim hook
  api.on('inbound_claim', async (event, _ctx) => {
    const match = matchNaturalLanguage(event.content)
    if (!match) return undefined

    // Build a synthetic PluginCommandContext-like object (minimal)
    const fakeCtx = {
      channel: _ctx.channelId ?? 'unknown',
      isAuthorizedSender: event.commandAuthorized ?? false,
      config: api.config,
      commandBody: event.content,
      args: '',
      requestConversationBinding: async () => ({ status: 'error' as const, message: 'not supported' }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    }

    let result
    if (match === 'report') {
      result = await handleReport(fakeCtx as Parameters<typeof handleReport>[0])
    } else {
      result = await handleStatus(fakeCtx as Parameters<typeof handleStatus>[0])
    }

    // Return handled=true so OpenClaw skips the LLM agent for this message
    // Note: inbound_claim result shape is { handled: boolean }
    // We log the reply; actual delivery happens via the channel's reply pipeline
    api.logger.info(`[jackclaw] natural-language intercept (${match}): ${result.text?.slice(0, 80)}…`)

    // We can't directly reply here, but we signal that we handled it.
    // The full reply goes through the before_dispatch hook below.
    return { handled: false } // let the agent handle but with context
  })

  // 3. before_dispatch hook: intercept natural-language triggers before LLM
  api.on('before_dispatch', async (event, _ctx) => {
    const match = matchNaturalLanguage(event.content ?? '')
    if (!match) return undefined

    try {
      let text: string
      if (match === 'report') {
        const alive = await hubHealthCheck()
        if (!alive) {
          text = '⚠️ JackClaw Hub 离线，无法获取汇报数据。'
        } else {
          const summary = await fetchSummary()
          text = formatSummary(summary)
        }
      } else {
        const alive = await hubHealthCheck()
        if (!alive) {
          text = '⚠️ JackClaw Hub 离线，无法获取节点状态。'
        } else {
          const nodes = await fetchNodes()
          text = formatNodeStatus(nodes)
        }
      }

      return { handled: true, text }
    } catch (err) {
      api.logger.warn(`[jackclaw] before_dispatch error: ${String(err)}`)
      return { handled: true, text: `❌ JackClaw 查询失败：${String(err)}` }
    }
  })

  // 4. Register background Hub poller service (includes team node AutoReply)
  api.registerService(buildJackclawService(hubUrl, autoRegister, teamNodes, gatewayUrl))

  api.logger.info('[jackclaw] JackClaw plugin registered ✅')
}
