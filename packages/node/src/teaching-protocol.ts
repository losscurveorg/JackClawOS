import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

export type TeachingState = "pending" | "active" | "completed" | "rejected" | "expired"

export interface TeachingRequest {
  id: string
  from: string          // 学习方 nodeId
  to: string            // 教学方 nodeId
  topic: string
  clearAfterSession: boolean
  requestedAt: number
  expiresAt: number
}

export interface KnowledgeEntry {
  key: string
  value: string
  confidence: number    // 0-1
}

export interface TeachingSession {
  id: string
  request: TeachingRequest
  state: TeachingState
  memoryScope: string   // "teaching-{id}"，独立目录
  knowledge: KnowledgeEntry[]
  startedAt?: number
  completedAt?: number
}

export class TeachingProtocol {
  private sessions = new Map<string, TeachingSession>()
  private storePath: string

  constructor(private nodeId: string) {
    this.storePath = path.join(os.homedir(), ".jackclaw", "teaching", nodeId)
    fs.mkdirSync(this.storePath, { recursive: true })
    this.load()
  }

  createRequest(to: string, topic: string, clearAfterSession = true): TeachingRequest {
    const req: TeachingRequest = {
      id: crypto.randomUUID(),
      from: this.nodeId,
      to,
      topic,
      clearAfterSession,
      requestedAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30min
    }
    const session: TeachingSession = {
      id: req.id,
      request: req,
      state: "pending",
      memoryScope: `teaching-${req.id}`,
      knowledge: [],
    }
    this.sessions.set(req.id, session)
    this.save()
    return req
  }

  accept(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.state !== "pending") return
    s.state = "active"
    s.startedAt = Date.now()
    // 创建独立教学记忆目录
    fs.mkdirSync(path.join(this.storePath, s.memoryScope), { recursive: true })
    this.save()
  }

  reject(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (s) { s.state = "rejected"; this.save() }
  }

  addKnowledge(sessionId: string, entries: KnowledgeEntry[]): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.state !== "active") return
    s.knowledge.push(...entries)
    // 写入独立教学记忆目录
    const file = path.join(this.storePath, s.memoryScope, "knowledge.jsonl")
    const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n"
    fs.appendFileSync(file, lines)
    this.save()
  }

  complete(sessionId: string): KnowledgeEntry[] {
    const s = this.sessions.get(sessionId)
    if (!s || s.state !== "active") return []
    s.state = "completed"
    s.completedAt = Date.now()
    const knowledge = [...s.knowledge]
    if (s.request.clearAfterSession) {
      // 清除独立教学记忆目录（隐私保护）
      fs.rmSync(path.join(this.storePath, s.memoryScope), { recursive: true, force: true })
      console.log(`[teaching] Cleared teaching memory: ${s.memoryScope}`)
    }
    this.save()
    return knowledge
  }

  getSessions(state?: TeachingState): TeachingSession[] {
    return [...this.sessions.values()].filter(s => !state || s.state === state)
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
