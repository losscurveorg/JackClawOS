/**
 * GroupStore — 群组 & 频道持久化存储
 *
 * - 内存 + JSON 文件双写
 * - 支持群组（group）和频道（channel）
 * - 频道：只有 admins 可发消息，其余成员是订阅者
 * - 支持邀请码、消息历史、置顶消息
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GroupType = 'group' | 'channel'

export interface Group {
  id: string
  name: string
  type: GroupType
  avatar?: string
  announcement?: string        // 公告
  createdBy: string            // nodeId of creator
  admins: string[]             // nodeId 列表（群主 + 管理员）
  members: string[]            // 全量成员（含管理员）
  inviteCode: string
  createdAt: number
  updatedAt: number
  pinnedMessageIds: string[]
}

export interface GroupMessage {
  id: string
  groupId: string
  from: string                 // nodeId
  content: string
  replyToId?: string           // 回复某条消息（频道评论用）
  ts: number
}

// ─── Persistence ───────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const GROUPS_FILE   = path.join(HUB_DIR, 'groups.json')
const GMESSAGES_FILE = path.join(HUB_DIR, 'group-messages.json')

function loadJSON<T>(file: string, def: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return def
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── GroupStore ────────────────────────────────────────────────────────────────

export class GroupStore {
  private groups: Map<string, Group>
  private messages: GroupMessage[]
  // inviteCode → groupId 快速索引
  private inviteIndex: Map<string, string>

  constructor() {
    const groupList: Group[] = loadJSON<Group[]>(GROUPS_FILE, [])
    this.groups = new Map(groupList.map(g => [g.id, g]))
    this.messages = loadJSON<GroupMessage[]>(GMESSAGES_FILE, [])
    this.inviteIndex = new Map(groupList.map(g => [g.inviteCode, g.id]))
  }

  // ─── Persistence helpers ────────────────────────────────────────────────────

  private persist(): void {
    saveJSON(GROUPS_FILE, [...this.groups.values()])
  }

  private persistMessages(): void {
    saveJSON(GMESSAGES_FILE, this.messages)
  }

  // ─── Invite code ───────────────────────────────────────────────────────────

  private generateInviteCode(): string {
    let code: string
    do {
      code = crypto.randomBytes(5).toString('hex').toUpperCase()
    } while (this.inviteIndex.has(code))
    return code
  }

  // ─── Group CRUD ─────────────────────────────────────────────────────────────

  create(params: {
    name: string
    members: string[]
    createdBy: string
    avatar?: string
    type?: GroupType
  }): Group {
    const id = crypto.randomUUID()
    const inviteCode = this.generateInviteCode()
    const now = Date.now()

    // creator 自动加入成员和管理员
    const membersSet = new Set([params.createdBy, ...params.members])

    const group: Group = {
      id,
      name: params.name,
      type: params.type ?? 'group',
      avatar: params.avatar,
      announcement: undefined,
      createdBy: params.createdBy,
      admins: [params.createdBy],
      members: [...membersSet],
      inviteCode,
      createdAt: now,
      updatedAt: now,
      pinnedMessageIds: [],
    }

    this.groups.set(id, group)
    this.inviteIndex.set(inviteCode, id)
    this.persist()
    return group
  }

  get(id: string): Group | null {
    return this.groups.get(id) ?? null
  }

  listForMember(nodeId: string): Group[] {
    return [...this.groups.values()]
      .filter(g => g.members.includes(nodeId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  update(id: string, patch: { name?: string; avatar?: string; announcement?: string }): Group | null {
    const g = this.groups.get(id)
    if (!g) return null
    if (patch.name !== undefined) g.name = patch.name
    if (patch.avatar !== undefined) g.avatar = patch.avatar
    if (patch.announcement !== undefined) g.announcement = patch.announcement
    g.updatedAt = Date.now()
    this.persist()
    return g
  }

  // ─── Member management ──────────────────────────────────────────────────────

  addMembers(groupId: string, nodeIds: string[]): Group | null {
    const g = this.groups.get(groupId)
    if (!g) return null
    const set = new Set(g.members)
    for (const id of nodeIds) set.add(id)
    g.members = [...set]
    g.updatedAt = Date.now()
    this.persist()
    return g
  }

  removeMember(groupId: string, nodeId: string): Group | null {
    const g = this.groups.get(groupId)
    if (!g) return null
    g.members = g.members.filter(m => m !== nodeId)
    g.admins = g.admins.filter(a => a !== nodeId)
    g.updatedAt = Date.now()
    this.persist()
    return g
  }

  isAdmin(groupId: string, nodeId: string): boolean {
    return this.groups.get(groupId)?.admins.includes(nodeId) ?? false
  }

  isMember(groupId: string, nodeId: string): boolean {
    return this.groups.get(groupId)?.members.includes(nodeId) ?? false
  }

  // ─── Invite code join ───────────────────────────────────────────────────────

  joinByInvite(inviteCode: string, nodeId: string): Group | null {
    const groupId = this.inviteIndex.get(inviteCode)
    if (!groupId) return null
    return this.addMembers(groupId, [nodeId])
  }

  // ─── Messages ───────────────────────────────────────────────────────────────

  addMessage(params: {
    groupId: string
    from: string
    content: string
    replyToId?: string
  }): GroupMessage {
    const msg: GroupMessage = {
      id: crypto.randomUUID(),
      groupId: params.groupId,
      from: params.from,
      content: params.content,
      replyToId: params.replyToId,
      ts: Date.now(),
    }
    this.messages.push(msg)
    // 更新群组 updatedAt
    const g = this.groups.get(params.groupId)
    if (g) { g.updatedAt = Date.now(); this.persist() }
    this.persistMessages()
    return msg
  }

  getMessages(groupId: string, limit = 50, before?: number): GroupMessage[] {
    let msgs = this.messages.filter(m => m.groupId === groupId)
    if (before !== undefined) msgs = msgs.filter(m => m.ts < before)
    return msgs.sort((a, b) => a.ts - b.ts).slice(-limit)
  }

  // ─── Pin ────────────────────────────────────────────────────────────────────

  pinMessage(groupId: string, messageId: string): Group | null {
    const g = this.groups.get(groupId)
    if (!g) return null
    if (!g.pinnedMessageIds.includes(messageId)) {
      g.pinnedMessageIds.push(messageId)
      g.updatedAt = Date.now()
      this.persist()
    }
    return g
  }
}

// Singleton
export const groupStore = new GroupStore()
