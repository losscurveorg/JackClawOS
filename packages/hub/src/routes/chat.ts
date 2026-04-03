/**
 * Hub ClawChat 路由
 *
 * POST /chat/send     — 发送消息（Hub 中转或推送）
 * GET  /chat/inbox    — 拉取离线消息
 * GET  /chat/threads  — 获取会话列表
 * GET  /chat/thread/:id — 获取会话历史
 * POST /chat/thread   — 创建会话
 * WS   /chat/ws       — WebSocket 实时推送
 */

import { Router, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { ChatStore } from '../store/chat'
import type { ChatMessage, ChatGroup } from '../store/chat'
import { isHumanTarget, getHuman, pushToHuman } from '../store/human-registry'

const router = Router()
const store = new ChatStore()

// WebSocket 连接池：nodeId → ws
const wsClients = new Map<string, WebSocket>()

// ─── REST 路由 ────────────────────────────────────────────────────────────────

// 发送消息
router.post('/send', (req: Request, res: Response) => {
  const msg = req.body as ChatMessage

  if (!msg?.id || !msg?.from || !msg?.to || !msg?.content) {
    res.status(400).json({ error: 'Invalid message format' })
    return
  }

  store.saveMessage(msg)

  // 如果 to 是群组 ID，展开为成员列表（排除发送方自己）
  const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to
  const group = store.getGroup(toId)
  const targets = group
    ? group.members.filter(m => m !== msg.from)
    : (Array.isArray(msg.to) ? msg.to : [msg.to])

  const delivered: string[] = []
  const queued: string[] = []

  for (const target of targets) {
    const payload = group
      ? { ...msg, groupId: group.groupId, groupName: group.name }
      : msg

    // Human 账号：webhook 推送
    if (isHumanTarget(target)) {
      const human = getHuman(target)
      if (human) {
        pushToHuman(human, { from: msg.from, content: msg.content, type: msg.type, id: msg.id })
          .catch(() => {})
      }
      continue
    }

    // Agent Node：WebSocket
    const ws = wsClients.get(target)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'message', data: payload }))
      delivered.push(target)
    } else {
      store.queueForOffline(target, payload as ChatMessage)
      queued.push(target)
    }
  }

  res.json({ status: 'ok', messageId: msg.id, delivered, queued })
})

// 拉取离线消息（Node 上线时调用）
router.get('/inbox', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  const msgs = store.drainInbox(nodeId)
  res.json({ messages: msgs, count: msgs.length })
})

// 会话列表
router.get('/threads', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ threads: store.listThreads(nodeId) })
})

// 会话历史
router.get('/thread/:id', (req: Request, res: Response) => {
  const messages = store.getThread(req.params.id)
  res.json({ messages })
})

// 创建会话
router.post('/thread', (req: Request, res: Response) => {
  const { participants, title } = req.body
  if (!Array.isArray(participants) || participants.length < 2) {
    res.status(400).json({ error: 'participants must be array of 2+ nodeIds' })
    return
  }
  const thread = store.createThread(participants, title)
  res.json({ thread })
})

// 创建群组
router.post('/group/create', (req: Request, res: Response) => {
  const { name, members, topic } = req.body
  const nodeId = req.query.nodeId as string | undefined
  const createdBy = (req.body.createdBy ?? nodeId) as string | undefined
  if (!name || !Array.isArray(members) || members.length < 2 || !createdBy) {
    res.status(400).json({ error: 'name, members (2+), and createdBy required' })
    return
  }
  const group = store.createGroup(name, members, createdBy, topic)
  res.json({ group })
})

// 列出我参与的群组
router.get('/groups', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ groups: store.listGroups(nodeId) })
})

// POST /chat/human/register — 注册人类账号（humanId + webhookUrl）
// 之后发消息时 to: ["bob-human", "bob-node"] 即可同时送达人和 AI
import { registerHuman, listHumans } from '../store/human-registry'

router.post('/human/register', (req: Request, res: Response) => {
  const { humanId, displayName, agentNodeId, webhookUrl, feishuOpenId } = req.body ?? {}
  if (!humanId || !displayName) {
    res.status(400).json({ error: 'humanId and displayName required' })
    return
  }
  const human = registerHuman({ humanId, displayName, agentNodeId, webhookUrl, feishuOpenId })
  res.json({ status: 'ok', human })
})

router.get('/humans', (_req: Request, res: Response) => {
  res.json({ humans: listHumans() })
})

export { router as chatRouter }

// ─── WebSocket 服务 ───────────────────────────────────────────────────────────

export function attachChatWss(server: import('http').Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/chat/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const nodeId = url.searchParams.get('nodeId')

    if (!nodeId) {
      ws.close(4001, 'nodeId required')
      return
    }

    // 注册连接
    wsClients.set(nodeId, ws)
    console.log(`[chat-ws] ${nodeId} connected`)

    // 上线立即推送离线消息
    const pending = store.drainInbox(nodeId)
    if (pending.length > 0) {
      ws.send(JSON.stringify({ event: 'inbox', data: pending }))
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ChatMessage
        store.saveMessage(msg)

        // 查询是否是群组消息
        const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to
        const group = store.getGroup(toId)

        // 确定实际投递目标（群组展开成员，个人保持原逻辑）
        const targets = group
          ? group.members.filter(m => m !== msg.from)
          : (Array.isArray(msg.to) ? msg.to : [msg.to])

        for (const target of targets) {
          const payload = group
            ? { ...msg, groupId: group.groupId, groupName: group.name }
            : msg

          // Human 账号：走 webhook 推送（手机/飞书/ClawChat App）
          if (isHumanTarget(target)) {
            const human = getHuman(target)
            if (human) {
              setImmediate(() => pushToHuman(human, { from: msg.from, content: msg.content, type: msg.type, id: msg.id }))
            }
            continue
          }

          // Agent Node：走 WebSocket
          const targetWs = wsClients.get(target)
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({ event: 'message', data: payload }))
          } else {
            store.queueForOffline(target, payload as ChatMessage)
          }
        }

        // task 消息：自动触发 TaskPlanner 规划并回传发送方
        if (msg.type === 'task') {
          setImmediate(async () => {
            try {
              const planResp = await fetch('http://localhost:3100/api/plan/estimate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  taskId: msg.id,
                  title: msg.content.slice(0, 80),
                  description: msg.content,
                  useAi: false,
                })
              })
              const { plan, formatted } = await planResp.json() as { plan: unknown; formatted?: string }
              const planMsg: ChatMessage = {
                id: `plan-${msg.id}`,
                from: 'hub-planner',
                to: msg.from,
                content: formatted ?? JSON.stringify(plan),
                type: 'plan-result',
                ts: Date.now(),
                signature: '',
                encrypted: false,
                metadata: { plan }
              }
              const senderWs = wsClients.get(msg.from)
              if (senderWs?.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify({ event: 'message', data: planMsg }))
              } else {
                store.queueForOffline(msg.from, planMsg)
              }
            } catch (_e) { /* 规划失败不影响消息路由 */ }
          })
        }

        // 静默更新 Owner Memory（type='human' 消息，后台观察，不阻塞）
        if (msg.type === 'human') {
          setImmediate(() => {
            store.observeMessage(msg.from, {
              content: msg.content,
              direction: 'incoming',
              type: msg.type,
            })
          })
        }

        // ACK
        ws.send(JSON.stringify({ event: 'ack', messageId: msg.id }))
      } catch (e) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid message format' }))
      }
    })

    ws.on('close', () => {
      wsClients.delete(nodeId)
      console.log(`[chat-ws] ${nodeId} disconnected`)
    })
  })

  return wss
}
