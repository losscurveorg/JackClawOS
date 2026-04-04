/**
 * Context Store — LLM-aware conversation context management
 *
 * Core principle: messages route through WebSocket at ZERO token cost.
 * Only when AI processing is needed, the Context Store provides:
 *   1. Recent K messages (not full history)
 *   2. Auto-compressed summaries for older context
 *   3. Model-independent storage (switch models without losing context)
 *
 * Token savings:
 *   - Regular routing: 0 tokens (pure WebSocket)
 *   - AI processing: summary + recent K = ~80% less than full history
 *   - Model switch: rebuild from store, not resend
 */

import { eventBus } from './event-bus'

interface ContextEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  messageId?: string
  tokenEstimate: number
}

interface ConversationContext {
  threadId: string
  entries: ContextEntry[]
  summary: string | null
  summaryTokens: number
  totalMessages: number
  lastSummarizedAt: number
  createdAt: number
}

/** Rough token estimator (1 token ≈ 4 chars for English, ≈ 2 chars for Chinese) */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 2 + otherChars / 4)
}

export class ContextStore {
  private contexts = new Map<string, ConversationContext>()
  private readonly maxEntriesBeforeSummary: number
  private readonly maxRecentEntries: number
  private readonly maxTokensPerContext: number

  constructor(opts?: {
    maxEntriesBeforeSummary?: number
    maxRecentEntries?: number
    maxTokensPerContext?: number
  }) {
    this.maxEntriesBeforeSummary = opts?.maxEntriesBeforeSummary ?? 20
    this.maxRecentEntries = opts?.maxRecentEntries ?? 10
    this.maxTokensPerContext = opts?.maxTokensPerContext ?? 8000
  }

  /**
   * Add a message to the context.
   * Returns true if a summary should be triggered.
   */
  addMessage(threadId: string, role: 'user' | 'assistant' | 'system', content: string, messageId?: string): boolean {
    let ctx = this.contexts.get(threadId)
    if (!ctx) {
      ctx = {
        threadId,
        entries: [],
        summary: null,
        summaryTokens: 0,
        totalMessages: 0,
        lastSummarizedAt: 0,
        createdAt: Date.now(),
      }
      this.contexts.set(threadId, ctx)
    }

    const entry: ContextEntry = {
      role,
      content,
      ts: Date.now(),
      messageId,
      tokenEstimate: estimateTokens(content),
    }

    ctx.entries.push(entry)
    ctx.totalMessages++

    // Emit event for any listeners
    eventBus.emit('context.updated', { threadId, totalMessages: ctx.totalMessages })

    // Check if summary is needed
    return ctx.entries.length >= this.maxEntriesBeforeSummary
  }

  /**
   * Get context for LLM call.
   * Returns: [summary (if exists)] + [recent K messages]
   * This is what gets sent to the model — NOT the full history.
   */
  getContextForLLM(threadId: string): ContextEntry[] {
    const ctx = this.contexts.get(threadId)
    if (!ctx) return []

    const result: ContextEntry[] = []

    // Add summary as system message if exists
    if (ctx.summary) {
      result.push({
        role: 'system',
        content: `[Previous conversation summary]\n${ctx.summary}`,
        ts: ctx.lastSummarizedAt,
        tokenEstimate: ctx.summaryTokens,
      })
    }

    // Add recent K entries
    const recent = ctx.entries.slice(-this.maxRecentEntries)
    result.push(...recent)

    return result
  }

  /**
   * Get estimated token count for the current context window.
   */
  getTokenEstimate(threadId: string): number {
    const ctx = this.contexts.get(threadId)
    if (!ctx) return 0

    let tokens = ctx.summaryTokens
    const recent = ctx.entries.slice(-this.maxRecentEntries)
    for (const entry of recent) {
      tokens += entry.tokenEstimate
    }
    return tokens
  }

  /**
   * Apply a summary to compress old messages.
   * Called after LLM generates a summary of older entries.
   * Removes summarized entries, keeps only recent K.
   */
  applySummary(threadId: string, summary: string): void {
    const ctx = this.contexts.get(threadId)
    if (!ctx) return

    ctx.summary = summary
    ctx.summaryTokens = estimateTokens(summary)
    ctx.lastSummarizedAt = Date.now()

    // Keep only recent entries
    ctx.entries = ctx.entries.slice(-this.maxRecentEntries)

    eventBus.emit('context.summarized', {
      threadId,
      summaryTokens: ctx.summaryTokens,
      entriesKept: ctx.entries.length,
      totalMessages: ctx.totalMessages,
    })
  }

  /**
   * Get full raw entries (for debugging / export).
   */
  getRawEntries(threadId: string): ContextEntry[] {
    return this.contexts.get(threadId)?.entries ?? []
  }

  /**
   * Get stats for a thread.
   */
  getStats(threadId: string): {
    totalMessages: number
    currentEntries: number
    hasSummary: boolean
    estimatedTokens: number
  } | null {
    const ctx = this.contexts.get(threadId)
    if (!ctx) return null
    return {
      totalMessages: ctx.totalMessages,
      currentEntries: ctx.entries.length,
      hasSummary: !!ctx.summary,
      estimatedTokens: this.getTokenEstimate(threadId),
    }
  }

  /**
   * Clear context for a thread.
   */
  clear(threadId: string): void {
    this.contexts.delete(threadId)
  }

  /**
   * Global stats.
   */
  globalStats(): { activeThreads: number; totalEntries: number; totalTokens: number } {
    let totalEntries = 0
    let totalTokens = 0
    for (const ctx of this.contexts.values()) {
      totalEntries += ctx.entries.length
      totalTokens += this.getTokenEstimate(ctx.threadId)
    }
    return {
      activeThreads: this.contexts.size,
      totalEntries,
      totalTokens,
    }
  }
}

/** Singleton Context Store */
export const contextStore = new ContextStore()
