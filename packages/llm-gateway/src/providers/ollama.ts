/**
 * Ollama provider — local LLM runtime (http://localhost:11434)
 *
 * Features:
 * - Auto-detects whether Ollama is running before any request
 * - Dynamically lists installed models via GET /api/tags
 * - Falls back gracefully when Ollama is not running
 * - Compatible with any model pulled via `ollama pull <model>`
 */
import http from 'http'
import https from 'https'
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ProviderConfig, ChatMessage, TokenUsage
} from '../types.js'

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama'
  readonly type = 'local' as const
  models: string[]
  private baseUrl: string
  private timeoutMs: number
  private _cachedModels: string[] | null = null
  private _lastModelFetch = 0

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? 60000
    // Static model hints from config (may be empty — getModels() is authoritative)
    const staticModels = Object.values(config.models ?? {})
    if (config.defaultModel && !staticModels.includes(config.defaultModel)) {
      staticModels.push(config.defaultModel)
    }
    this.models = staticModels.length ? staticModels : ['llama3', 'qwen2.5', 'mistral']
  }

  // ─── Availability & model discovery ───────────────────────────────

  async isAvailable(): Promise<boolean> {
    return this.ping()
  }

  async ping(): Promise<boolean> {
    try {
      await this.httpGet('/')
      return true
    } catch {
      return false
    }
  }

  /** Fetch live model list from Ollama. Caches result for 30 s. */
  async getModels(): Promise<string[]> {
    const now = Date.now()
    if (this._cachedModels && now - this._lastModelFetch < 30_000) {
      return this._cachedModels
    }
    try {
      const data = await this.httpGet('/api/tags')
      const names: string[] = (data.models ?? []).map((m: any) => m.name as string)
      this._cachedModels = names
      this._lastModelFetch = now
      // Sync static list with live list
      for (const n of names) {
        if (!this.models.includes(n)) this.models.push(n)
      }
      return names
    } catch {
      return this.models
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const start = Date.now()
    const body = {
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
        ...(request.max_tokens !== undefined ? { num_predict: request.max_tokens } : {}),
      },
    }
    const data = await this.httpPost('/api/chat', body)

    return {
      id: `ollama-${Date.now()}`,
      model: data.model ?? request.model,
      provider: 'ollama',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.message?.content ?? '',
        } as ChatMessage,
        finish_reason: data.done ? 'stop' : 'length',
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count ?? 0,
        completion_tokens: data.eval_count ?? 0,
        total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      } as TokenUsage,
      latencyMs: Date.now() - start,
      raw: data,
    }
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamDelta> {
    const body = {
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
        ...(request.max_tokens !== undefined ? { num_predict: request.max_tokens } : {}),
      },
    }

    const url = new URL(this.baseUrl + '/api/chat')
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeoutMs,
      }, resolve)
      req.on('error', reject)
      req.write(JSON.stringify(body))
      req.end()
    })

    let buffer = ''
    for await (const chunk of response) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const data = JSON.parse(trimmed)
          yield {
            id: `ollama-${Date.now()}`,
            model: data.model ?? request.model,
            provider: 'ollama',
            choices: [{
              index: 0,
              delta: { content: data.message?.content ?? '' },
              finish_reason: data.done ? 'stop' : null,
            }],
          }
          if (data.done) return
        } catch {}
      }
    }
  }

  async *stream(messages: ChatMessage[], options: Partial<ChatRequest> = {}): AsyncGenerator<string> {
    const request: ChatRequest = {
      model: this.models[0] ?? 'llama3',
      messages,
      ...options,
    }
    for await (const delta of this.chatStream(request)) {
      const text = delta.choices[0]?.delta.content
      if (text) yield text
    }
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────

  private httpGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const transport = url.protocol === 'https:' ? https : http
      const req = transport.get(url, { timeout: 5000 }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`ollama ${res.statusCode}`))
            return
          }
          try { resolve(d ? JSON.parse(d) : {}) }
          catch { resolve({}) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('ollama timeout')) })
    })
  }

  private httpPost(path: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeoutMs,
      }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`ollama API error ${res.statusCode}: ${d.slice(0, 200)}`))
            return
          }
          try { resolve(JSON.parse(d)) }
          catch { reject(new Error(`ollama invalid JSON: ${d.slice(0, 200)}`)) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('ollama timeout')) })
      req.write(JSON.stringify(body))
      req.end()
    })
  }
}
