import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

export type TeachingState = "pending" | "active" | "completed" | "rejected" | "expired"

export interface TeachingRequest {
  id: string
  from: string        // 学习方 nodeId
  to: string          // 教学方 nodeId
  topic: string
  clearAfterSession: boolean  // 是否在 session 结束后清除教学记忆
  createdAt: number
  expiresAt: number
}

export interface TeachingSession {
  id: string
  request: TeachingRequest
  state: TeachingState
  memoryScope: string   // teaching-{sessionId}，独立目录
  knowledgeItems: KnowledgeItem[]
  startedAt?: number
  completedAt?: number
}

export interface KnowledgeItem {
  id: string
  topic: string
  content: string
  type: "concept" | "procedure" | "example" | "rule"
  addedAt: number
}

export class TeachingProtocol {
  private sessions = new Map<string, TeachingSession>()
  private storePath: string

  constructor(private nodeId: string) {
    this.storePath = path.join(os.homedir(), ".jackclaw", "teaching", nodeId)
    fs.mkdirSync(this.storePath, { recursive: true })
    this.load()
  }

  createRequest(opts: { to: string; topic: string; clearAfterSession?: boolean }): TeachingRequest {
    const req: TeachingRequest = {
      id: crypto.randomUUID(),
      from: this.nodeId,
      to: opts.to,
      topic: opts.topic,
      clearAfterSession: opts.clearAfterSession ?? true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,  // 30分钟
    }
    return req
  }

  acceptRequest(request: TeachingRequest): TeachingSession {
    const session: TeachingSession = {
      id: crypto.randomUUID(),
      request,
      state: "active",
      memoryScope: `teaching-${crypto.randomUUID().slice(0, 8)}`,
      knowledgeItems: [],
      startedAt: Date.now(),
    }
    this.sessions.set(session.id, session)
    // 创建独立 memory 目录
    fs.mkdirSync(path.join(this.storePath, session.memoryScope), { recursive: true })
    this.save()
    return session
  }

  rejectRequest(requestId: string): void {
    // 通知发起方被拒绝（通过 ClawChat）
    console.log(`[teaching] Request ${requestId} rejected`)
  }

  addKnowledge(sessionId: string, item: Omit<KnowledgeItem, "id" | "addedAt">): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.state !== "active") throw new Error("Session not active")
    const knowledge: KnowledgeItem = { ...item, id: crypto.randomUUID(), addedAt: Date.now() }
    session.knowledgeItems.push(knowledge)
    // 写入独立 memory 目录
    const memDir = path.join(this.storePath, session.memoryScope)
    fs.appendFileSync(path.join(memDir, "knowledge.jsonl"), JSON.stringify(knowledge) + "\n")
    this.save()
  }

  complete(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error("Session not found")
    session.state = "completed"
    session.completedAt = Date.now()
    if (session.request.clearAfterSession) {
      // 清除教学记忆（隐私保护）
      const memDir = path.join(this.storePath, session.memoryScope)
      fs.rmSync(memDir, { recursive: true, force: true })
      console.log(`[teaching] Memory cleared for session ${sessionId}`)
    }
    this.save()
  }

  getActiveSessions(): TeachingSession[] {
    return [...this.sessions.values()].filter(s => s.state === "active")
  }

  private load(): void {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.storePath, "sessions.json"), "utf-8"))
      for (const s of data) this.sessions.set(s.id, s)
    } catch {}
  }

  private save(): void {
    fs.writeFileSync(
      path.join(this.storePath, "sessions.json"),
      JSON.stringify([...this.sessions.values()], null, 2)
    )
  }
}
