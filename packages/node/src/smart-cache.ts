/**
 * JackClaw SmartCache — API 缓存感知 + Token 最小化引擎
 *
 * 问题：中转站（road2all/one-api等）大多不支持 Anthropic prompt caching，
 *       导致每次调用都重发完整 system prompt + memory，浪费大量 token。
 *
 * 解决：自动探测中转站缓存能力，不支持时启用本地增量压缩策略。
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ─── 缓存能力探测 ────────────────────────────────────────────────────────────

export type CacheCapability =
  | 'native'    // 支持 Anthropic prompt caching（读取 anthropic-cache-read-input-tokens）
  | 'partial'   // 部分支持（透传但无效）
  | 'none'      // 不支持，启用本地缓存策略

export interface CacheProbeResult {
  provider: string
  baseUrl: string
  capability: CacheCapability
  detectedAt: number
  cacheReadTokens: number   // 上次探测中实际命中的缓存 token 数
  cacheWriteTokens: number  // 上次探测中写入缓存的 token 数
}

// ─── Token 优化策略 ──────────────────────────────────────────────────────────

export type OptimizationStrategy =
  | 'full'          // 完整发送（原生缓存可用）
  | 'incremental'   // 只发增量 diff（本地缓存命中）
  | 'compressed'    // 压缩 memory（只发相关条目）
  | 'sliding'       // 滑动窗口（超长对话）

export interface OptimizedPayload {
  systemPrompt: string
  messages: Message[]
  strategy: OptimizationStrategy
  estimatedTokens: number
  savedTokens: number     // 相比不优化节省的 token 数
  cacheControl?: unknown  // Anthropic cache_control 标记
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ContentBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

// ─── 使用统计 ────────────────────────────────────────────────────────────────

export interface TokenUsageRecord {
  requestId: string
  nodeId: string
  model: string
  provider: string
  strategy: OptimizationStrategy
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  savedTokens: number
  timestamp: number
}

export interface TokenSavingsReport {
  nodeId: string
  period: 'today' | '7d' | '30d' | 'all'
  totalRequests: number
  totalInputTokens: number
  totalCacheReadTokens: number
  totalSavedTokens: number
  savingsRate: number     // 节省比例 0-1
  estimatedCostSaved: number  // USD
  byStrategy: Record<OptimizationStrategy, number>
}

// ─── SmartCache 核心实现 ─────────────────────────────────────────────────────

export class SmartCache {
  private cacheDir: string
  private probeCache: Map<string, CacheProbeResult> = new Map()
  private contentHashCache: Map<string, string> = new Map()  // hash → compressed content
  private usageLog: TokenUsageRecord[] = []

  constructor(private nodeId: string, private baseDir = path.join(os.homedir(), '.jackclaw')) {
    this.cacheDir = path.join(baseDir, 'smart-cache', nodeId)
    fs.mkdirSync(this.cacheDir, { recursive: true })
    this.loadProbeCache()
    this.loadUsageLog()
  }

  /**
   * 探测中转站是否支持 Anthropic prompt caching
   * 发送一个带 cache_control 的测试请求，检查响应头
   */
  async detectCacheSupport(
    baseUrl: string,
    authToken: string,
    model: string
  ): Promise<CacheProbeResult> {
    const cacheKey = `${baseUrl}:${model}`

    // 如果24小时内已探测过，直接返回缓存结果
    const cached = this.probeCache.get(cacheKey)
    if (cached && Date.now() - cached.detectedAt < 24 * 60 * 60 * 1000) {
      return cached
    }

    const testSystemPrompt = 'You are a helpful assistant. ' + 'x'.repeat(1024) // 需要足够长才能触发缓存

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          system: [{ type: 'text', text: testSystemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      const data = await response.json() as any
      const usage = data.usage ?? {}

      const cacheReadTokens = usage.cache_read_input_tokens ?? 0
      const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

      // 如果有写入缓存的 token，说明支持 native caching
      let capability: CacheCapability = 'none'
      if (cacheWriteTokens > 0) {
        capability = 'native'
      } else if (response.headers.get('anthropic-cache-read-input-tokens') !== null) {
        capability = 'partial'
      }

      const result: CacheProbeResult = {
        provider: new URL(baseUrl).hostname,
        baseUrl,
        capability,
        detectedAt: Date.now(),
        cacheReadTokens,
        cacheWriteTokens,
      }

      this.probeCache.set(cacheKey, result)
      this.saveProbeCache()
      return result
    } catch {
      // 探测失败，假设不支持
      const result: CacheProbeResult = {
        provider: new URL(baseUrl).hostname,
        baseUrl,
        capability: 'none',
        detectedAt: Date.now(),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }
      this.probeCache.set(cacheKey, result)
      return result
    }
  }

  /**
   * 根据缓存能力，构建最优的请求 payload
   */
  buildOptimalPayload(opts: {
    systemPrompt: string
    memoryEntries: Array<{ type: string; content: string; tags?: string[] }>
    messages: Message[]
    queryContext?: string    // 当前查询，用于过滤相关 memory
    capability: CacheCapability
    maxMemoryEntries?: number
  }): OptimizedPayload {
    const { systemPrompt, memoryEntries, messages, queryContext, capability, maxMemoryEntries = 20 } = opts

    if (capability === 'native') {
      // 原生缓存：添加 cache_control 标记，完整发送
      return this.buildNativePayload(systemPrompt, memoryEntries, messages)
    }

    // 本地优化策略：压缩 memory + 增量消息
    const relevantMemory = this.filterRelevantMemory(memoryEntries, queryContext, maxMemoryEntries)
    const compressedSystem = this.buildCompressedSystem(systemPrompt, relevantMemory)

    const fullSize = this.estimateTokens(systemPrompt) +
      memoryEntries.reduce((s, e) => s + this.estimateTokens(e.content), 0)
    const compressedSize = this.estimateTokens(compressedSystem)
    const savedTokens = Math.max(0, fullSize - compressedSize)

    // 如果对话很长，使用滑动窗口
    const strategy: OptimizationStrategy =
      messages.length > 20 ? 'sliding' : savedTokens > 0 ? 'compressed' : 'full'

    const finalMessages = strategy === 'sliding'
      ? this.applySlideWindow(messages, 20)
      : messages

    return {
      systemPrompt: compressedSystem,
      messages: finalMessages,
      strategy,
      estimatedTokens: compressedSize + finalMessages.reduce((s, m) =>
        s + this.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0),
      savedTokens,
    }
  }

  /**
   * 记录 token 使用情况
   */
  trackUsage(record: Omit<TokenUsageRecord, 'nodeId'>): void {
    this.usageLog.push({ ...record, nodeId: this.nodeId })
    // 只保留最近1000条
    if (this.usageLog.length > 1000) {
      this.usageLog = this.usageLog.slice(-1000)
    }
    this.saveUsageLog()
  }

  /**
   * 生成 token 节省报告
   */
  getSavingsReport(period: TokenSavingsReport['period'] = 'today'): TokenSavingsReport {
    const now = Date.now()
    const cutoff = period === 'today' ? now - 86400000
      : period === '7d' ? now - 7 * 86400000
      : period === '30d' ? now - 30 * 86400000
      : 0

    const records = this.usageLog.filter(r => r.timestamp >= cutoff)
    const totalInput = records.reduce((s, r) => s + r.inputTokens, 0)
    const totalCacheRead = records.reduce((s, r) => s + r.cacheReadTokens, 0)
    const totalSaved = records.reduce((s, r) => s + r.savedTokens, 0)
    const savingsRate = totalInput > 0 ? totalSaved / (totalInput + totalSaved) : 0

    // claude-opus-4 输入 $15/M tokens
    const estimatedCostSaved = totalSaved * 0.000015

    const byStrategy: Record<OptimizationStrategy, number> = {
      full: 0, incremental: 0, compressed: 0, sliding: 0,
    }
    for (const r of records) {
      byStrategy[r.strategy] = (byStrategy[r.strategy] ?? 0) + r.savedTokens
    }

    return {
      nodeId: this.nodeId,
      period,
      totalRequests: records.length,
      totalInputTokens: totalInput,
      totalCacheReadTokens: totalCacheRead,
      totalSavedTokens: totalSaved,
      savingsRate,
      estimatedCostSaved,
      byStrategy,
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  private buildNativePayload(
    systemPrompt: string,
    memoryEntries: Array<{ type: string; content: string }>,
    messages: Message[]
  ): OptimizedPayload {
    const memoryText = memoryEntries.map(e => `[${e.type}] ${e.content}`).join('\n')
    const fullSystem = `${systemPrompt}\n\n## Memory\n${memoryText}`

    return {
      systemPrompt: fullSystem,
      messages,
      strategy: 'full',
      estimatedTokens: this.estimateTokens(fullSystem),
      savedTokens: 0,
      cacheControl: { type: 'ephemeral' },
    }
  }

  private filterRelevantMemory(
    entries: Array<{ type: string; content: string; tags?: string[] }>,
    queryContext?: string,
    maxEntries = 20
  ) {
    if (!queryContext || entries.length <= maxEntries) return entries.slice(0, maxEntries)

    // 简单关键词匹配打分
    const queryWords = queryContext.toLowerCase().split(/\s+/)
    const scored = entries.map(e => {
      const text = (e.content + ' ' + (e.tags ?? []).join(' ')).toLowerCase()
      const score = queryWords.filter(w => text.includes(w)).length
      return { entry: e, score }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxEntries)
      .map(s => s.entry)
  }

  private buildCompressedSystem(
    systemPrompt: string,
    relevantMemory: Array<{ type: string; content: string }>
  ): string {
    const memText = relevantMemory
      .map(e => `[${e.type}] ${e.content}`)
      .join('\n')
    return memText ? `${systemPrompt}\n\n## Relevant Memory\n${memText}` : systemPrompt
  }

  private applySlideWindow(messages: Message[], windowSize: number): Message[] {
    if (messages.length <= windowSize) return messages
    // 保留第一条（通常是系统上下文）+ 最近 N-1 条
    return [messages[0], ...messages.slice(-(windowSize - 1))]
  }

  private estimateTokens(text: string): number {
    // 粗略估算：1 token ≈ 4 字符（英文）≈ 2 汉字
    return Math.ceil(text.length / 3)
  }

  private loadProbeCache() {
    const file = path.join(this.cacheDir, 'probe-cache.json')
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      for (const [k, v] of Object.entries(data)) {
        this.probeCache.set(k, v as CacheProbeResult)
      }
    } catch { /* 首次运行 */ }
  }

  private saveProbeCache() {
    const file = path.join(this.cacheDir, 'probe-cache.json')
    const data = Object.fromEntries(this.probeCache)
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  }

  private loadUsageLog() {
    const file = path.join(this.cacheDir, 'usage.jsonl')
    try {
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean)
      this.usageLog = lines.map(l => JSON.parse(l))
    } catch { /* 首次运行 */ }
  }

  private saveUsageLog() {
    const file = path.join(this.cacheDir, 'usage.jsonl')
    const lines = this.usageLog.map(r => JSON.stringify(r)).join('\n')
    fs.writeFileSync(file, lines + '\n')
  }
}

// 单例工厂
const instances = new Map<string, SmartCache>()
export function getSmartCache(nodeId: string): SmartCache {
  if (!instances.has(nodeId)) {
    instances.set(nodeId, new SmartCache(nodeId))
  }
  return instances.get(nodeId)!
}
