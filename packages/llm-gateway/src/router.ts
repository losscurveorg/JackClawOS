/**
 * ModelRouter — Smart provider selection with priority and fallback
 *
 * Routing priority (highest → lowest):
 *   1. Explicit model string with provider prefix (e.g. "ollama/qwen2.5:7b")
 *   2. Local providers when available (lowest latency, free)
 *   3. Cloud providers in cost order (cheapest first)
 *   4. Fallback chain from config
 */
import type { LLMProvider, ChatRequest, ChatResponse } from './types.js'

export interface RouteRequest {
  /** Full model string, optionally prefixed: "ollama/qwen2.5:7b" or "qwen2.5:7b" */
  model?: string
  /** Explicitly force a specific provider */
  provider?: string
  /** Allow local providers (default true) */
  preferLocal?: boolean
}

export interface ModelInfo {
  model: string
  provider: string
  type: 'cloud' | 'local'
  available: boolean
}

export class ModelRouter {
  private providers = new Map<string, LLMProvider>()
  private fallbackChain: string[] = []

  // ─── Registration ─────────────────────────────────────────────────

  registerProvider(provider: LLMProvider): this {
    this.providers.set(provider.name, provider)
    return this
  }

  setFallbackChain(chain: string[]): this {
    this.fallbackChain = chain
    return this
  }

  // ─── Routing ──────────────────────────────────────────────────────

  /**
   * Select the best available provider for a request.
   *
   * Resolution order:
   *   1. `request.provider` (explicit override)
   *   2. Provider prefix in model string ("ollama/qwen2.5:7b" → ollama)
   *   3. Model-name heuristics (prefix matching)
   *   4. First available local provider
   *   5. First registered provider (default)
   */
  getProviderForModel(model: string, preferredProvider?: string): LLMProvider {
    // 1. Explicit provider name
    if (preferredProvider) {
      const p = this.providers.get(preferredProvider)
      if (p) return p
    }

    // 2. Provider prefix in model string ("ollama/qwen2.5:7b")
    if (model.includes('/')) {
      const [prefix, ...rest] = model.split('/')
      const p = this.providers.get(prefix)
      if (p) return p
      // treat rest as the actual model name for further matching
      model = rest.join('/')
    }

    // 3. Heuristic model-name matching
    const match = this.matchByModelName(model)
    if (match) return match

    // 4. Default
    return this.getDefault()
  }

  /**
   * Route a request and execute it with automatic fallback.
   * Tries providers in priority order, falls back on error.
   */
  async route(request: ChatRequest & { preferLocal?: boolean }): Promise<ChatResponse> {
    const { preferLocal = true, ...chatRequest } = request

    // Build candidate list
    const candidates = this.buildCandidateList(chatRequest.model, preferLocal)

    let lastErr: Error | undefined
    for (const providerName of candidates) {
      const provider = this.providers.get(providerName)
      if (!provider) continue
      try {
        return await provider.chat(chatRequest)
      } catch (err: any) {
        console.warn(`[router] ${providerName} failed: ${err.message}`)
        lastErr = err
      }
    }

    throw lastErr ?? new Error('[router] No providers available')
  }

  // ─── Discovery ────────────────────────────────────────────────────

  /** List all models across all registered providers (parallel fetch). */
  async listAvailableModels(): Promise<ModelInfo[]> {
    const results: ModelInfo[] = []
    await Promise.all(
      [...this.providers.entries()].map(async ([name, provider]) => {
        try {
          const available = await provider.isAvailable()
          const models = await provider.getModels()
          for (const model of models) {
            results.push({ model, provider: name, type: provider.type, available })
          }
        } catch {
          // Provider unreachable — still list static models as unavailable
          for (const model of provider.models) {
            results.push({ model, provider: name, type: provider.type, available: false })
          }
        }
      }),
    )
    // Sort: local first, then alphabetical
    return results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'local' ? -1 : 1
      return a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)
    })
  }

  /** Check availability of all providers in parallel. */
  async pingAll(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {}
    await Promise.all(
      [...this.providers.entries()].map(async ([name, p]) => {
        out[name] = await p.isAvailable().catch(() => false)
      }),
    )
    return out
  }

  listProviders(): LLMProvider[] {
    return [...this.providers.values()]
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Build ordered candidate provider list for a model.
   * Priority: local providers first (when preferLocal=true), then cloud.
   */
  private buildCandidateList(model: string, preferLocal: boolean): string[] {
    const primary = this.getProviderForModel(model)
    const seen = new Set<string>([primary.name])
    const candidates: string[] = [primary.name]

    if (preferLocal) {
      // Insert local providers before the primary if primary is cloud
      for (const [name, p] of this.providers) {
        if (p.type === 'local' && !seen.has(name)) {
          candidates.unshift(name)
          seen.add(name)
        }
      }
    }

    // Append fallback chain
    for (const name of this.fallbackChain) {
      if (!seen.has(name) && this.providers.has(name)) {
        candidates.push(name)
        seen.add(name)
      }
    }

    return candidates
  }

  private matchByModelName(model: string): LLMProvider | undefined {
    const m = model.toLowerCase()

    // Ordered prefix rules
    const rules: Array<[RegExp, string]> = [
      [/^claude/,    'anthropic'],
      [/^gpt|^o[13]-/, 'openai'],
      [/^gemini/,    'google'],
      [/^deepseek/,  'deepseek'],
      [/^qwen/,      'qwen'],
      [/^ernie/,     'ernie'],
      [/^hunyuan/,   'hunyuan'],
      [/^moonshot/,  'kimi'],
      [/^glm/,       'zhipu'],
      [/^baichuan/i, 'baichuan'],
      [/^general/,   'spark'],
      [/^llama|^mistral|^gemma|^phi/, 'ollama'],
    ]

    for (const [pattern, providerName] of rules) {
      if (pattern.test(m)) {
        const p = this.providers.get(providerName)
        if (p) return p
      }
    }
    return undefined
  }

  private getDefault(): LLMProvider {
    // Prefer local providers as default
    for (const p of this.providers.values()) {
      if (p.type === 'local') return p
    }
    const first = this.providers.values().next().value
    if (!first) throw new Error('[router] No providers registered')
    return first
  }
}
