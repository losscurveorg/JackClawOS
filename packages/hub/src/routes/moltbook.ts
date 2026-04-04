/**
 * Hub Moltbook Routes — manages all Node Moltbook connections.
 *
 * POST /api/moltbook/connect  — connect Moltbook account (store API key)
 * GET  /api/moltbook/status   — connection status + karma + post count
 * POST /api/moltbook/post     — post via Hub
 * GET  /api/moltbook/feed     — get feed
 * POST /api/moltbook/sync     — manual feed sync
 * GET  /api/moltbook/digest   — get daily digest text
 *
 * Auth: all routes require JWT (already enforced in server.ts for /api/*).
 * Per-node Moltbook keys stored in ~/.jackclaw/hub/moltbook-keys.json
 */

import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'

const router = Router()

const HUB_DIR      = path.join(os.homedir(), '.jackclaw', 'hub')
const MOLTBOOK_DIR = path.join(HUB_DIR, 'moltbook')
const KEYS_FILE    = path.join(MOLTBOOK_DIR, 'keys.json')
const FEED_FILE    = path.join(MOLTBOOK_DIR, 'feed-cache.json')

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1'

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ensureDir(): void {
  fs.mkdirSync(MOLTBOOK_DIR, { recursive: true })
}

function loadKeys(): Record<string, string> {
  ensureDir()
  try {
    if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')) as Record<string, string>
  } catch { /* ignore */ }
  return {}
}

function saveKeys(keys: Record<string, string>): void {
  ensureDir()
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 })
}

function loadFeedCache(): Record<string, unknown[]> {
  try {
    if (fs.existsSync(FEED_FILE)) return JSON.parse(fs.readFileSync(FEED_FILE, 'utf-8')) as Record<string, unknown[]>
  } catch { /* ignore */ }
  return {}
}

function saveFeedCache(cache: Record<string, unknown[]>): void {
  ensureDir()
  fs.writeFileSync(FEED_FILE, JSON.stringify(cache, null, 2))
}

// ─── Moltbook API proxy helper ────────────────────────────────────────────────

interface MoltbookRequestOpts {
  method: string
  endpoint: string
  apiKey: string
  body?: unknown
  params?: Record<string, string>
}

async function moltbookRequest<T>(opts: MoltbookRequestOpts): Promise<T> {
  let url = `${MOLTBOOK_API}${opts.endpoint}`
  if (opts.params && Object.keys(opts.params).length > 0) {
    url += '?' + new URLSearchParams(opts.params).toString()
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${opts.apiKey}`,
  }

  const init: RequestInit = { method: opts.method, headers }
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

  let res = await fetch(url, init)

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
    res = await fetch(url, init)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Moltbook ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

function getNodeId(req: Request): string {
  return req.jwtPayload?.nodeId ?? 'unknown'
}

// ─── POST /connect ─────────────────────────────────────────────────────────────

router.post('/connect', (req: Request, res: Response): void => {
  const { apiKey } = req.body as { apiKey?: string }
  if (!apiKey) {
    res.status(400).json({ error: 'apiKey required' })
    return
  }

  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  keys[nodeId] = apiKey
  saveKeys(keys)

  console.log(`[moltbook] Node ${nodeId} connected Moltbook account`)
  res.json({ status: 'ok', nodeId, message: 'Moltbook account connected' })
})

// ─── GET /status ───────────────────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response): Promise<void> => {
  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  const apiKey = keys[nodeId]

  if (!apiKey) {
    res.json({ connected: false, nodeId })
    return
  }

  try {
    const me = await moltbookRequest<{
      name: string; karma: number; postCount: number; commentCount: number
    }>({ method: 'GET', endpoint: '/agents/me', apiKey })

    res.json({ connected: true, nodeId, agent: me })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ connected: true, nodeId, error: msg })
  }
})

// ─── POST /post ────────────────────────────────────────────────────────────────

router.post('/post', async (req: Request, res: Response): Promise<void> => {
  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  const apiKey = keys[nodeId]

  if (!apiKey) {
    res.status(403).json({ error: 'Moltbook not connected for this node' })
    return
  }

  const { submolt, title, content, url } = req.body as {
    submolt?: string; title?: string; content?: string; url?: string
  }

  if (!submolt || !title || !content) {
    res.status(400).json({ error: 'submolt, title, content required' })
    return
  }

  try {
    const body: Record<string, string> = { submolt, title, content }
    if (url) body['url'] = url
    const post = await moltbookRequest<{ id: string; title: string; submolt: string }>(
      { method: 'POST', endpoint: '/posts', apiKey, body },
    )
    console.log(`[moltbook] Node ${nodeId} posted: id=${post.id} "${title.slice(0, 50)}"`)
    res.status(201).json({ status: 'ok', post })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: msg })
  }
})

// ─── GET /feed ─────────────────────────────────────────────────────────────────

router.get('/feed', async (req: Request, res: Response): Promise<void> => {
  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  const apiKey = keys[nodeId]

  if (!apiKey) {
    res.status(403).json({ error: 'Moltbook not connected for this node' })
    return
  }

  const sort  = (req.query['sort'] as string) ?? 'hot'
  const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 20

  try {
    const result = await moltbookRequest<{ posts?: unknown[] }>(
      { method: 'GET', endpoint: '/feed', apiKey, params: { sort, limit: String(limit) } },
    )
    const posts = result.posts ?? []

    // Update feed cache
    const cache = loadFeedCache()
    cache[nodeId] = posts
    saveFeedCache(cache)

    res.json({ posts, count: posts.length, sort })
  } catch (err: unknown) {
    // Return cached feed on error
    const cache = loadFeedCache()
    const cached = cache[nodeId] ?? []
    const msg = err instanceof Error ? err.message : String(err)
    if (cached.length > 0) {
      res.json({ posts: cached, count: cached.length, sort, cached: true, error: msg })
    } else {
      res.status(502).json({ error: msg })
    }
  }
})

// ─── POST /sync ────────────────────────────────────────────────────────────────

router.post('/sync', async (req: Request, res: Response): Promise<void> => {
  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  const apiKey = keys[nodeId]

  if (!apiKey) {
    res.status(403).json({ error: 'Moltbook not connected for this node' })
    return
  }

  try {
    const result = await moltbookRequest<{ posts?: unknown[] }>(
      { method: 'GET', endpoint: '/feed', apiKey, params: { sort: 'new', limit: '50' } },
    )
    const posts = result.posts ?? []
    const cache = loadFeedCache()
    cache[nodeId] = posts
    saveFeedCache(cache)

    console.log(`[moltbook] Sync for node ${nodeId}: ${posts.length} posts`)
    res.json({ status: 'ok', synced: posts.length, ts: Date.now() })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: msg })
  }
})

// ─── GET /digest ───────────────────────────────────────────────────────────────

router.get('/digest', async (req: Request, res: Response): Promise<void> => {
  const nodeId = getNodeId(req)
  const keys   = loadKeys()
  const apiKey = keys[nodeId]

  if (!apiKey) {
    res.status(403).json({ error: 'Moltbook not connected for this node' })
    return
  }

  try {
    // Fetch top posts from hot feed
    const result = await moltbookRequest<{ posts?: Array<{ title: string; submolt: string; score: number; author: string }> }>(
      { method: 'GET', endpoint: '/posts', apiKey, params: { sort: 'hot', limit: '10' } },
    )
    const posts = result.posts ?? []

    // Fetch agent stats
    let agentStats = ''
    try {
      const me = await moltbookRequest<{ name: string; karma: number; postCount: number }>(
        { method: 'GET', endpoint: '/agents/me', apiKey },
      )
      agentStats = `Agent: ${me.name} | Karma: ${me.karma} | Posts: ${me.postCount}`
    } catch { /* best-effort */ }

    const postList = posts.map(p =>
      `[${p.score}↑] "${p.title}" in m/${p.submolt} by ${p.author}`,
    ).join('\n')

    const digest = `[Moltbook Digest — ${new Date().toLocaleDateString()}]\n${agentStats}\n\nTop Posts:\n${postList || 'No posts yet.'}`
    res.json({ digest, postCount: posts.length, ts: Date.now() })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: msg })
  }
})

export default router
