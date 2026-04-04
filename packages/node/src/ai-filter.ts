/**
 * AI Message Filter — rules-based engine (no LLM dependency)
 *
 * Config: ~/.jackclaw/node/filter.json
 * Log:    ~/.jackclaw/node/filter-log.jsonl
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { SocialMessage } from '@jackclaw/protocol'

export type FilterAction = 'allow' | 'flag' | 'block'

export interface FilterResult {
  action: FilterAction
  reason: string
  confidence: number // 0–1
}

interface KeywordRule {
  word: string
  action: 'flag' | 'block'
}

interface FilterConfig {
  whitelist: string[]   // @handles always allowed (skip all other checks)
  blacklist: string[]   // @handles always blocked
  keywords: KeywordRule[]
}

export interface FilterLogEntry {
  ts: number
  messageId: string
  fromAgent: string
  action: FilterAction
  reason: string
  contentPreview: string
}

export interface DailyStats {
  date: string  // YYYY-MM-DD
  allowed: number
  flagged: number
  blocked: number
  total: number
}

const FILTER_DIR  = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_FILE = path.join(FILTER_DIR, 'filter.json')
const LOG_FILE    = path.join(FILTER_DIR, 'filter-log.jsonl')

// Suspicious patterns: IP-based URLs and common URL shorteners
const SUSPICIOUS_URL_RE =
  /https?:\/\/(\d{1,3}\.){3}\d{1,3}|bit\.ly\/|tinyurl\.com\/|t\.co\/|goo\.gl\//i

const DEFAULT_CONFIG: FilterConfig = {
  whitelist: [],
  blacklist: [],
  keywords: [
    { word: '广告', action: 'flag' },
    { word: 'spam',  action: 'flag' },
    { word: '色情',  action: 'block' },
    { word: 'phishing', action: 'block' },
  ],
}

export class MessageFilter {
  private config: FilterConfig
  // rate-limit tracking: handle → arrival timestamps (last 60 s)
  private readonly rateBucket = new Map<string, number[]>()
  // duplicate detection: handle → { content, ts }[]
  private readonly recentContent = new Map<string, Array<{ content: string; ts: number }>>()
  // in-memory stats (reset when date changes)
  private stats: Omit<DailyStats, 'total'> = { date: this._today(), allowed: 0, flagged: 0, blocked: 0 }

  constructor() {
    this.config = this._loadConfig()
    fs.mkdirSync(FILTER_DIR, { recursive: true })
  }

  /** Analyse an incoming social message and decide what to do with it. */
  analyze(msg: SocialMessage): FilterResult {
    const { fromAgent: handle, content, id } = msg
    const now = Date.now()

    // 1. Blacklist → always block
    if (this._inList(handle, this.config.blacklist)) {
      return this._record('block', `sender ${handle} is blacklisted`, 1.0, msg)
    }

    // 2. Whitelist → skip all further checks
    if (this._inList(handle, this.config.whitelist)) {
      return this._record('allow', 'whitelisted sender', 1.0, msg)
    }

    // 3. Duplicate content spam (same content from same sender within 5 min)
    const prevContent = (this.recentContent.get(handle) ?? []).filter(e => now - e.ts < 5 * 60_000)
    if (prevContent.some(e => e.content === content)) {
      return this._record('block', 'duplicate content spam', 0.95, msg)
    }
    prevContent.push({ content, ts: now })
    this.recentContent.set(handle, prevContent)

    // 4. Rate limit: > 10 messages in 60 seconds → flag
    const bucket = (this.rateBucket.get(handle) ?? []).filter(t => now - t < 60_000)
    bucket.push(now)
    this.rateBucket.set(handle, bucket)
    if (bucket.length > 10) {
      return this._record('flag', `rate limit exceeded (${bucket.length} msgs/min)`, 0.9, msg)
    }

    // 5. Keyword filter
    const lower = content.toLowerCase()
    for (const { word, action } of this.config.keywords) {
      if (lower.includes(word.toLowerCase())) {
        return this._record(action, `keyword match: "${word}"`, 0.85, msg)
      }
    }

    // 6. Suspicious URL detection
    if (SUSPICIOUS_URL_RE.test(content)) {
      return this._record('flag', 'suspicious URL detected', 0.8, msg)
    }

    return this._record('allow', 'passed all filters', 0.99, msg)
  }

  // ── Whitelist / Blacklist management ────────────────────────────────────────

  addToWhitelist(handle: string): void {
    const h = this._norm(handle)
    if (!this.config.whitelist.includes(h)) {
      this.config.whitelist.push(h)
      this.config.blacklist = this.config.blacklist.filter(x => x !== h)
      this._saveConfig()
    }
  }

  removeFromWhitelist(handle: string): void {
    const h = this._norm(handle)
    this.config.whitelist = this.config.whitelist.filter(x => x !== h)
    this._saveConfig()
  }

  addToBlacklist(handle: string): void {
    const h = this._norm(handle)
    if (!this.config.blacklist.includes(h)) {
      this.config.blacklist.push(h)
      this.config.whitelist = this.config.whitelist.filter(x => x !== h)
      this._saveConfig()
    }
  }

  removeFromBlacklist(handle: string): void {
    const h = this._norm(handle)
    this.config.blacklist = this.config.blacklist.filter(x => x !== h)
    this._saveConfig()
  }

  // ── Keyword management ───────────────────────────────────────────────────────

  addKeyword(word: string, action: 'flag' | 'block'): void {
    if (!this.config.keywords.some(k => k.word === word)) {
      this.config.keywords.push({ word, action })
      this._saveConfig()
    }
  }

  removeKeyword(word: string): void {
    this.config.keywords = this.config.keywords.filter(k => k.word !== word)
    this._saveConfig()
  }

  // ── Stats / Inspection ───────────────────────────────────────────────────────

  /** Today's in-memory filter statistics. */
  getStats(): DailyStats {
    this._resetIfNewDay()
    return { ...this.stats, total: this.stats.allowed + this.stats.flagged + this.stats.blocked }
  }

  /**
   * Return all log entries where action === 'block' or 'flag',
   * sorted newest first, limited to today.
   */
  getBlocked(): FilterLogEntry[] {
    if (!fs.existsSync(LOG_FILE)) return []
    const today = this._today()
    return fs.readFileSync(LOG_FILE, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l) as FilterLogEntry } catch { return null } })
      .filter((e): e is FilterLogEntry => e !== null && new Date(e.ts).toISOString().startsWith(today))
      .reverse()
  }

  getConfig(): FilterConfig {
    return { ...this.config, keywords: [...this.config.keywords] }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _record(action: FilterAction, reason: string, confidence: number, msg: SocialMessage): FilterResult {
    this._resetIfNewDay()
    if (action === 'allow') this.stats.allowed++
    else if (action === 'flag') this.stats.flagged++
    else this.stats.blocked++

    if (action !== 'allow') {
      this._appendLog({
        ts: Date.now(),
        messageId: msg.id,
        fromAgent: msg.fromAgent,
        action,
        reason,
        contentPreview: msg.content.slice(0, 100),
      })
    }

    return { action, reason, confidence }
  }

  private _appendLog(entry: FilterLogEntry): void {
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8')
    } catch {
      // Non-critical — silently ignore log write failures
    }
  }

  private _inList(handle: string, list: string[]): boolean {
    const h = this._norm(handle)
    return list.some(x => x === h || x === handle)
  }

  private _norm(handle: string): string {
    return handle.startsWith('@') ? handle : `@${handle}`
  }

  private _today(): string {
    return new Date().toISOString().split('T')[0]!
  }

  private _resetIfNewDay(): void {
    if (this.stats.date !== this._today()) {
      this.stats = { date: this._today(), allowed: 0, flagged: 0, blocked: 0 }
    }
  }

  private _loadConfig(): FilterConfig {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.mkdirSync(FILTER_DIR, { recursive: true })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      return { ...DEFAULT_CONFIG, keywords: [...DEFAULT_CONFIG.keywords] }
    }
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as FilterConfig
    } catch {
      return { ...DEFAULT_CONFIG, keywords: [...DEFAULT_CONFIG.keywords] }
    }
  }

  private _saveConfig(): void {
    try {
      fs.mkdirSync(FILTER_DIR, { recursive: true })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2))
    } catch (err: unknown) {
      console.warn('[filter] Failed to save config:', err)
    }
  }
}
