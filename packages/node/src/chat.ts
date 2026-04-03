/**
 * ClawChat — JackClaw 原生消息通道
 *
 * 人↔Agent↔人 的 IM 系统，内置于 JackClaw 网络。
 * 消息即指令：type='task' 直接触发 Agent 执行。
 * E2E 加密，离线队列，WebSocket 实时推送。
 */

import { randomUUID } from 'crypto'
import { encrypt, decrypt, sign, verify } from '@jackclaw/protocol'
import type { NodeIdentity } from '@jackclaw/protocol'

// ─── 消息类型 ────────────────────────────────────────────────────────────────

export type ChatMessageType =
  | 'human'       // 纯人类对话，Agent 只路由不介入
  | 'task'        // 触发 Agent 执行链（进入 AutoRetry）
  | 'ask'         // Agent 执行后需要人类确认才继续
  | 'broadcast'   // Hub 广播（公告/紧急/系统消息）
  | 'reply'       // 回复某条消息
  | 'ack'         // 已读确认

export interface ChatMessage {
  id: string
  threadId?: string          // 所属会话线程
  replyToId?: string         // 回复的消息 ID
  from: string               // nodeId
  to: string | string[]      // nodeId 或 nodeId[]（群发）
  type: ChatMessageType
  content: string
  attachments?: ChatAttachment[]
  ts: number
  signature: string          // 发送方私钥签名
  encrypted: boolean         // 内容是否已加密
  read?: boolean
  executionResult?: {        // type='task' 执行完毕后回填
    status: 'success' | 'failed' | 'pending-review'
    output: string
    attempts: number
  }
}

export interface ChatAttachment {
  name: string
  type: 'file' | 'image' | 'memory-ref' | 'task-result'
  url?: string
  data?: string              // base64 小文件
  memoryKey?: string         // memory-ref 类型
}

export interface ChatThread {
  id: string
  participants: string[]     // nodeId[]
  title?: string
  createdAt: number
  lastMessageAt: number
  messageCount: number
}

// ─── 消息存储 ────────────────────────────────────────────────────────────────

export class ChatStore {
  private messages: Map<string, ChatMessage> = new Map()
  private threads: Map<string, ChatThread> = new Map()
  private inbox: Map<string, ChatMessage[]> = new Map()  // nodeId → 未读消息队列（离线暂存）

  saveMessage(msg: ChatMessage): void {
    this.messages.set(msg.id, msg)

    // 更新 thread
    if (msg.threadId) {
      const thread = this.threads.get(msg.threadId)
      if (thread) {
        thread.lastMessageAt = msg.ts
        thread.messageCount++
      }
    }
  }

  getThread(threadId: string): ChatMessage[] {
    return [...this.messages.values()]
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.ts - b.ts)
  }

  getInbox(nodeId: string): ChatMessage[] {
    return this.inbox.get(nodeId) ?? []
  }

  queueForOffline(nodeId: string, msg: ChatMessage): void {
    const q = this.inbox.get(nodeId) ?? []
    q.push(msg)
    this.inbox.set(nodeId, q)
  }

  drainInbox(nodeId: string): ChatMessage[] {
    const msgs = this.inbox.get(nodeId) ?? []
    this.inbox.delete(nodeId)
    return msgs
  }

  createThread(participants: string[], title?: string): ChatThread {
    const thread: ChatThread = {
      id: randomUUID(),
      participants,
      title,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
    }
    this.threads.set(thread.id, thread)
    return thread
  }

  listThreads(nodeId: string): ChatThread[] {
    return [...this.threads.values()]
      .filter(t => t.participants.includes(nodeId))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }
}

// ─── 消息构建 ─────────────────────────────────────────────────────────────────

export function buildChatMessage(opts: {
  from: string
  to: string | string[]
  type: ChatMessageType
  content: string
  threadId?: string
  replyToId?: string
  attachments?: ChatAttachment[]
  identity: NodeIdentity
  recipientPublicKey?: string   // 有则加密
}): ChatMessage {
  const { identity, recipientPublicKey, ...rest } = opts

  let content = opts.content
  let encrypted = false

  if (recipientPublicKey && typeof opts.to === 'string') {
    // 单对单：E2E 加密
    const enc = encrypt(content, recipientPublicKey)
    content = JSON.stringify(enc)
    encrypted = true
  }

  const msg: Omit<ChatMessage, 'signature'> = {
    id: randomUUID(),
    threadId: opts.threadId,
    replyToId: opts.replyToId,
    from: opts.from,
    to: opts.to,
    type: opts.type,
    content,
    attachments: opts.attachments,
    ts: Date.now(),
    encrypted,
  }

  const signature = sign(JSON.stringify(msg), identity.privateKey)
  return { ...msg, signature }
}

export function decryptChatMessage(
  msg: ChatMessage,
  recipientPrivateKey: string,
): string {
  if (!msg.encrypted) return msg.content
  const enc = JSON.parse(msg.content)
  return decrypt(enc, recipientPrivateKey)
}

export function verifyChatMessage(
  msg: ChatMessage,
  senderPublicKey: string,
): boolean {
  const { signature, ...rest } = msg
  return verify(JSON.stringify(rest), signature, senderPublicKey)
}
