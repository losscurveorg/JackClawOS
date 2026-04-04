/**
 * MoltbookClient — native integration with the Moltbook AI Agent social network.
 * Uses Node.js native fetch (no axios). Handles 429 rate limiting with retry-after.
 * Config stored at ~/.jackclaw/node/moltbook.json
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1'
const CONFIG_DIR   = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_FILE  = path.join(CONFIG_DIR, 'moltbook.json')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MoltbookAgentInfo {
  name: string
  description: string
  karma: number
  postCount: number
  commentCount: number
  createdAt?: string
}

export interface MoltbookPost {
  id: string
  title: string
  content: string
  submolt: string
  url?: string
  author: string
  score: number
  commentCount: number
  createdAt: string
}

export interface MoltbookComment {
  id: string
  content: string
  author: string
  postId: string
  parentId?: string
  createdAt: string
}

export interface MoltbookSubmolt {
  name: string
  description: string
  subscriberCount: number
}

export interface MoltbookConfig {
  apiKey: string
  agent?: {
    name: string
    description: string
    karma?: number
  }
}

// ─── MoltbookClient ───────────────────────────────────────────────────────────

export class MoltbookClient {
  private apiKey: string
  private storedConfig: MoltbookConfig | null = null

  constructor(apiKey?: string) {
    this.storedConfig = this.loadConfig()
    this.apiKey = apiKey ?? this.storedConfig?.apiKey ?? ''
  }

  // ── Config persistence ─────────────────────────────────────────────────────

  private loadConfig(): MoltbookConfig | null {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as MoltbookConfig
      }
    } catch { /* ignore */ }
    return null
  }

  saveConfig(config: MoltbookConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
    this.storedConfig = config
    this.apiKey = config.apiKey
  }

  isConfigured(): boolean { return !!this.apiKey }
  getStoredConfig(): MoltbookConfig | null { return this.storedConfig }

  // ── HTTP core ──────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    let url = `${MOLTBOOK_API}${endpoint}`
    if (params && Object.keys(params).length > 0) {
      url += '?' + new URLSearchParams(params).toString()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const init: RequestInit = { method, headers }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res = await fetch(url, init)

    // Rate limit — wait retry-after seconds then retry once
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
      console.log(`[moltbook] Rate limited — waiting ${retryAfter}s before retry`)
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
      res = await fetch(url, init)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Moltbook ${res.status}: ${text}`)
    }

    return res.json() as Promise<T>
  }

  // ── Agent ──────────────────────────────────────────────────────────────────

  /** Register a new Agent on Moltbook. Persists returned api_key to config file. */
  async register(name: string, description: string): Promise<MoltbookAgentInfo> {
    const result = await this.request<{ api_key: string; agent: MoltbookAgentInfo }>(
      'POST', '/agents/register', { name, description },
    )
    this.saveConfig({ apiKey: result.api_key, agent: { name, description } })
    console.log(`[moltbook] Registered agent "${name}" — api_key saved to ${CONFIG_FILE}`)
    return result.agent
  }

  /** Get current Agent info (karma, post counts, etc.) */
  async getMe(): Promise<MoltbookAgentInfo> {
    return this.request<MoltbookAgentInfo>('GET', '/agents/me')
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  /** Create a new post. Rate limit: 1 post per 30 min. */
  async post(submolt: string, title: string, content: string, url?: string): Promise<MoltbookPost> {
    const body: Record<string, string> = { submolt, title, content }
    if (url) body['url'] = url
    return this.request<MoltbookPost>('POST', '/posts', body)
  }

  /** Get posts list sorted by hot/new/top/rising */
  async getPosts(sort: 'hot' | 'new' | 'top' | 'rising' = 'hot', limit = 20): Promise<MoltbookPost[]> {
    const result = await this.request<{ posts?: MoltbookPost[] }>(
      'GET', '/posts', undefined, { sort, limit: String(limit) },
    )
    return result.posts ?? []
  }

  /** Get a single post by ID */
  async getPost(postId: string): Promise<MoltbookPost> {
    return this.request<MoltbookPost>('GET', `/posts/${postId}`)
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  /** Comment on a post. Rate limit: 50 comments/hour. */
  async comment(postId: string, content: string, parentId?: string): Promise<MoltbookComment> {
    const body: Record<string, string> = { content }
    if (parentId) body['parentId'] = parentId
    return this.request<MoltbookComment>('POST', `/posts/${postId}/comments`, body)
  }

  // ── Voting ─────────────────────────────────────────────────────────────────

  async upvote(postId: string): Promise<void> {
    await this.request<unknown>('POST', `/posts/${postId}/upvote`)
  }

  async downvote(postId: string): Promise<void> {
    await this.request<unknown>('POST', `/posts/${postId}/downvote`)
  }

  // ── Feed & Search ──────────────────────────────────────────────────────────

  /** Get personalized feed */
  async getFeed(sort: 'hot' | 'new' | 'top' | 'rising' = 'hot', limit = 20): Promise<MoltbookPost[]> {
    const result = await this.request<{ posts?: MoltbookPost[] }>(
      'GET', '/feed', undefined, { sort, limit: String(limit) },
    )
    return result.posts ?? []
  }

  /** Full-text search */
  async search(query: string): Promise<MoltbookPost[]> {
    const result = await this.request<{ posts?: MoltbookPost[] }>(
      'GET', '/search', undefined, { q: query },
    )
    return result.posts ?? []
  }

  // ── Submolts ───────────────────────────────────────────────────────────────

  async listSubmolts(): Promise<MoltbookSubmolt[]> {
    const result = await this.request<{ submolts?: MoltbookSubmolt[] }>('GET', '/submolts')
    return result.submolts ?? []
  }

  async subscribe(submolt: string): Promise<void> {
    await this.request<unknown>('POST', `/submolts/${submolt}/subscribe`)
  }

  async unsubscribe(submolt: string): Promise<void> {
    await this.request<unknown>('POST', `/submolts/${submolt}/unsubscribe`)
  }

  // ── Social ─────────────────────────────────────────────────────────────────

  async follow(agentName: string): Promise<void> {
    await this.request<unknown>('POST', `/agents/${agentName}/follow`)
  }

  async unfollow(agentName: string): Promise<void> {
    await this.request<unknown>('POST', `/agents/${agentName}/unfollow`)
  }
}
