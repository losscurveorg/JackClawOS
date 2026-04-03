// Hub 侧 L3 内存存储 — org 共享记忆 + 协作会话 + 跨节点 MemDir 同步

import type { MemoryEntry, NodeRef, CollabSessionState, MemDir } from '@jackclaw/memory'

const orgMemories: Map<string, MemoryEntry> = new Map()
const collabSessions: Map<string, CollabSessionState> = new Map()
const nodeSkills: Map<string, NodeRef> = new Map()

// ── Org L3 记忆 ──────────────────────────────────────────

export function broadcastMemory(entry: MemoryEntry): void {
  orgMemories.set(entry.id, { ...entry, layer: 'L3', scope: 'org' })
}

export function getOrgMemories(): MemoryEntry[] {
  return [...orgMemories.values()]
}

// ── 技能索引 ─────────────────────────────────────────────

export function registerNodeSkills(nodeId: string, name: string, skills: string[]): void {
  nodeSkills.set(nodeId, { nodeId, name, skills })
}

export function findExpertsBySkill(skill: string): NodeRef[] {
  const lower = skill.toLowerCase()
  return [...nodeSkills.values()].filter(n =>
    n.skills.some(s => s.toLowerCase().includes(lower))
  )
}

// ── 协作会话 ─────────────────────────────────────────────

export function createCollabSession(state: CollabSessionState): void {
  collabSessions.set(state.id, state)
}

export function getCollabSession(id: string): CollabSessionState | undefined {
  return collabSessions.get(id)
}

export function syncCollabSession(id: string, entries: MemoryEntry[]): void {
  const session = collabSessions.get(id)
  if (!session) return
  session.entries.push(...entries)
}

export function endCollabSession(id: string, mode: string): CollabSessionState | undefined {
  const session = collabSessions.get(id)
  if (!session) return undefined
  session.status = 'ended'
  session.endMode = mode as CollabSessionState['endMode']
  collabSessions.delete(id)
  return session
}

// ── 跨节点 MemDir 同步 ─────────────────────────────────────────────────────

/** nodeId → 该节点推送来的 MemDir 条目（project/reference） */
const nodeSyncedMemories: Map<string, MemDir[]> = new Map()

/** 存储某节点推送的 MemDir 条目（覆盖旧数据） */
export function storeNodeMemDirs(nodeId: string, entries: MemDir[]): void {
  nodeSyncedMemories.set(nodeId, entries)
}

/**
 * 返回除 requestingNodeId 以外所有节点的共享 MemDir 条目。
 * 只对外暴露 project/reference 类型（push 端已过滤，此处双重保险）。
 */
export function getSharedMemDirs(requestingNodeId: string): MemDir[] {
  const SYNCABLE: Array<MemDir['type']> = ['project', 'reference']
  const result: MemDir[] = []
  for (const [nodeId, entries] of nodeSyncedMemories.entries()) {
    if (nodeId === requestingNodeId) continue
    for (const e of entries) {
      if (SYNCABLE.includes(e.type)) result.push(e)
    }
  }
  return result
}
