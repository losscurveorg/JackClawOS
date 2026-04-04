/**
 * OpenAI-compatible provider — works with:
 * OpenAI, DeepSeek, Groq, Together, Mistral, vLLM, LM Studio, Ollama, etc.
 *
 * Any service that implements the /v1/chat/completions endpoint.
 */
import https from 'https'
import http from 'http'
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ProviderConfig, ChatMessage, TokenUsage
} from '../types.js'

export class OpenAICompatibleProvider implements LLMProvider {
  name: string
  type: 'cloud' | 'local' = 'cloud'
  models: string[]
  protected baseUrl: string
  protected apiKey: string
  protected headers: Record<string, string>
  protected timeoutMs: number

  constructor(config: ProviderConfig) {
    this.name = config.provider
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '')
    this.apiKey = config.apiKey ?? ''
    this.timeoutMs = config.timeoutMs ?? 60000
    this.models = Object.values(config.models ?? {})
    if (config.defaultModel && !this.models.includes(config.defaultModel)) {
      this.models.push(config.defaultModel)
    }
    this.headers = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      ...(config.headers ?? {}),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const start = Date.now()
    const body = this.buildBody(request)
    const data = await this.post('/v1/chat/completions', body)
    return {
      id: data.id ?? `gen-${Date.now()}`,
      model: data.model ?? request.model,
      provider: this.name,
      choices: (data.choices ?? []).map((c: any, i: number) => ({
        index: i,
        message: {
          role: c.message?.role ?? 'assistant',
          content: c.message?.content ?? '',
          tool_calls: c.message?.tool_calls,
        } as ChatMessage,
        finish_reason: c.finish_reason ?? 'stop',
      })),
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      } as TokenUsage,
      latencyMs: Date.now() - start,
      raw: data,
    }
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamDelta> {
    const body = this.buildBody({ ...request, stream: true })
    const url = new URL(this.baseUrl + '/v1/chat/completions')
    const transport = url.protocol === 'https:' ? https : http

    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = transport.request(url, {
        method: 'POST',
        headers: this.headers,
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
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const payload = trimmed.slice(6)
        if (payload === '[DONE]') return
        try {
          const data = JSON.parse(payload)
          yield {
            id: data.id ?? '',
            model: data.model ?? request.model,
            provider: this.name,
            choices: (data.choices ?? []).map((c: any) => ({
              index: c.index ?? 0,
              delta: {
                role: c.delta?.role,
                content: c.delta?.content,
                tool_calls: c.delta?.tool_calls,
              },
              finish_reason: c.finish_reason,
            })),
          }
        } catch {}
      }
    }
  }

  async *stream(messages: ChatMessage[], options: Partial<ChatRequest> = {}): AsyncGenerator<string> {
    const request: ChatRequest = {
      model: this.models[0] ?? 'gpt-4o-mini',
      messages,
      ...options,
    }
    for await (const delta of this.chatStream(request)) {
      const text = delta.choices[0]?.delta.content
      if (text) yield text
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.ping()
  }

  async getModels(): Promise<string[]> {
    return this.models
  }

  async ping(): Promise<boolean> {
    try {
      await this.post('/v1/chat/completions', {
        model: this.models[0] ?? 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      })
      return true
    } catch {
      return false
    }
  }

  protected buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens
    if (request.top_p !== undefined) body.top_p = request.top_p
    if (request.stop) body.stop = request.stop
    if (request.tools) body.tools = request.tools
    if (request.tool_choice) body.tool_choice = request.tool_choice
    if (request.stream) body.stream = true
    if (request.json_mode) body.response_format = { type: 'json_object' }
    if (request.extra) Object.assign(body, request.extra)
    return body
  }

  protected post(path: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const transport = url.protocol === 'https:' ? https : http
      const req = transport.request(url, {
        method: 'POST',
        headers: this.headers,
        timeout: this.timeoutMs,
      }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${this.name} API error ${res.statusCode}: ${d.slice(0, 200)}`))
            return
          }
          try { resolve(JSON.parse(d)) }
          catch { reject(new Error(`${this.name} invalid JSON: ${d.slice(0, 200)}`)) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error(`${this.name} timeout`)) })
      req.write(JSON.stringify(body))
      req.end()
    })
  }

  protected get(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const transport = url.protocol === 'https:' ? https : http
      const req = transport.request(url, {
        method: 'GET',
        headers: this.headers,
        timeout: this.timeoutMs,
      }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${this.name} API error ${res.statusCode}: ${d.slice(0, 200)}`))
            return
          }
          try { resolve(JSON.parse(d)) }
          catch { reject(new Error(`${this.name} invalid JSON: ${d.slice(0, 200)}`)) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error(`${this.name} timeout`)) })
      req.end()
    })
  }
}
