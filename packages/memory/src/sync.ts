// Hub 同步 — L3 网络记忆 push/pull，技能发现，协作发起
// 新增：MemDirSync — 跨节点 MemDir 同步（project/reference 类型）

import crypto from 'crypto'
import type { MemoryEntry, NodeRef, CollabSessionState, MemDir } from './types.js'

// ── MemDirSync — 跨节点 MemDir 同步 ─────────────────────────────────────────

const SYNCABLE_TYPES: Array<MemDir['type']> = ['project', 'reference']

/**
 * 生成 HMAC-SHA256 签名
 * secret 优先从 JACKCLAW_SYNC_SECRET 环境变量读取
 */
function hmacSign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

function getSyncSecret(): string {
  const s = process.env['JACKCLAW_SYNC_SECRET'] ?? process.env['JWT_SECRET']
  if (!s) throw new Error('[MemDirSync] JACKCLAW_SYNC_SECRET env var is required for sync')
  return s
}

export class MemDirSync {
  constructor(private nodeId: string) {}

  /**
   * 把本地 project/reference 类型的记忆条目推送到 Hub。
   * 推送前用 HMAC-SHA256 签名请求体，Hub 侧校验完整性。
   */
  async push(entries: MemDir[], targetHubUrl: string): Promise<void> {
    const syncable = entries.filter(e => SYNCABLE_TYPES.includes(e.type))
    if (syncable.length === 0) return

    const body = JSON.stringify({ nodeId: this.nodeId, ts: Date.now(), entries: syncable })
    const sig = hmacSign(body, getSyncSecret())

    try {
      const res = await fetch(`${targetHubUrl}/api/memory/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Sig': sig,
          'X-Sync-Node': this.nodeId,
        },
        body,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      console.log(`[MemDirSync] Pushed ${syncable.length} entries to ${targetHubUrl}`)
    } catch (err) {
      console.error('[MemDirSync] push failed:', err)
    }
  }

  /**
   * 从 Hub 拉取其他节点共享的 project/reference 记忆。
   * 请求同样附带 HMAC 签名供 Hub 认证。
   */
  async pull(nodeId: string, hubUrl: string): Promise<MemDir[]> {
    const ts = Date.now()
    const query = `nodeId=${encodeURIComponent(nodeId)}&ts=${ts}`
    const sig = hmacSign(query, getSyncSecret())

    try {
      const res = await fetch(`${hubUrl}/api/memory/pull?${query}`, {
        headers: {
          'X-Sync-Sig': sig,
          'X-Sync-Node': this.nodeId,
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = await res.json() as { entries: MemDir[] }
      const entries = (data.entries ?? []).filter((e: MemDir) => SYNCABLE_TYPES.includes(e.type))
      console.log(`[MemDirSync] Pulled ${entries.length} entries from ${hubUrl}`)
      return entries
    } catch (err) {
      console.error('[MemDirSync] pull failed:', err)
      return []
    }
  }
}

// ── HubSync — 旧 L3 网络记忆（保留向后兼容） ─────────────────────────────────

export class HubSync {
  constructor(
    private agentId: string,
    private hubUrl: string
  ) {}

  /** 推送记忆到 org L3 */
  async pushToOrg(entry: MemoryEntry): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] pushToOrg failed:', err)
    }
  }

  /** 从 Hub 拉取 org L3 记忆 */
  async pullFromOrg(): Promise<MemoryEntry[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/org`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries: MemoryEntry[] }
      return data.entries ?? []
    } catch (err) {
      console.error('[sync] pullFromOrg failed:', err)
      return []
    }
  }

  /** 注册自己的技能到 Hub */
  async registerSkills(name: string, skills: string[]): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: this.agentId, name, skills }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] registerSkills failed:', err)
    }
  }

  /** 查找拥有某技能的 Agent */
  async findExpert(skill: string): Promise<NodeRef[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/experts?skill=${encodeURIComponent(skill)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { experts: NodeRef[] }
      return data.experts ?? []
    } catch (err) {
      console.error('[sync] findExpert failed:', err)
      return []
    }
  }

  /** 发起协作会话 */
  async initCollab(peerId: string, intent: string, topic?: string): Promise<string> {
    const res = await fetch(`${this.hubUrl}/memory/collab/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatorId: this.agentId, peerId, intent, topic }),
    })
    if (!res.ok) throw new Error(`[sync] initCollab HTTP ${res.status}`)
    const data = await res.json() as { sessionId: string }
    return data.sessionId
  }

  /** 同步协作记忆到 Hub */
  async syncCollab(sessionId: string, entries: MemoryEntry[]): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/collab/${sessionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] syncCollab failed:', err)
    }
  }

  /** 结束协作，返回对方的教学条目 */
  async endCollab(sessionId: string, mode: string): Promise<MemoryEntry[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/collab/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries: MemoryEntry[] }
      return data.entries ?? []
    } catch (err) {
      console.error('[sync] endCollab failed:', err)
      return []
    }
  }
}
