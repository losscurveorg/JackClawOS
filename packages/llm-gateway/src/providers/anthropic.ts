/**
 * Anthropic provider — Claude 4, Sonnet, Haiku, Opus
 *
 * Uses Anthropic Messages API (not OpenAI-compatible).
 */
import https from 'https'
import http from 'http'
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ProviderConfig, ChatMessage, TokenUsage
} from '../types.js'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  models: string[]
  private baseUrl: string
  private apiKey: string
  private timeoutMs: number
  private headers: Record<string, string>

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')
    this.apiKey = config.apiKey ?? ''
    this.timeoutMs = config.timeoutMs ?? 120000
    this.models = Object.values(config.models ?? {})
    if (config.defaultModel && !this.models.includes(config.defaultModel)) {
      this.models.push(config.defaultModel)
    }
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...(config.headers ?? {}),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const start = Date.now()
    const body = this.buildBody(request)
    const data = await this.post('/v1/messages', body)
    
    const content = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    const toolCalls = (data.content ?? [])
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({
        id: b.id,
        type: 'function' as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }))

    return {
      id: data.id ?? `claude-${Date.now()}`,
      model: data.model ?? request.model,
      provider: this.name,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: data.stop_reason === 'end_turn' ? 'stop'
          : data.stop_reason === 'tool_use' ? 'tool_calls'
          : data.stop_reason ?? 'stop',
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      latencyMs: Date.now() - start,
      raw: data,
    }
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamDelta> {
    const body = this.buildBody({ ...request, stream: true })
    const url = new URL(this.baseUrl + '/v1/messages')
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
        if (!trimmed.startsWith('data: ')) continue
        try {
          const data = JSON.parse(trimmed.slice(6))
          if (data.type === 'content_block_delta' && data.delta?.text) {
            yield {
              id: '',
              model: request.model,
              provider: this.name,
              choices: [{
                index: 0,
                delta: { content: data.delta.text },
                finish_reason: null,
              }],
            }
          }
          if (data.type === 'message_stop') {
            yield {
              id: '',
              model: request.model,
              provider: this.name,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
            }
          }
        } catch {}
      }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.chat({
        model: this.models[0] ?? 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      })
      return true
    } catch {
      return false
    }
  }

  private buildBody(request: ChatRequest): Record<string, unknown> {
    // Extract system message
    const systemMsgs = request.messages.filter(m => m.role === 'system')
    const nonSystemMsgs = request.messages.filter(m => m.role !== 'system')

    // Convert tool results to Anthropic format
    const messages = nonSystemMsgs.map(m => {
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content,
          }],
        }
      }
      return { role: m.role, content: m.content }
    })

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
    }

    if (systemMsgs.length) body.system = systemMsgs.map(m => m.content).join('\n')
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.top_p !== undefined) body.top_p = request.top_p
    if (request.stop) body.stop_sequences = request.stop
    if (request.stream) body.stream = true

    // Convert OpenAI tool format to Anthropic
    if (request.tools) {
      body.tools = request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }))
    }

    if (request.extra) Object.assign(body, request.extra)
    return body
  }

  private post(path: string, body: unknown): Promise<any> {
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
            reject(new Error(`Anthropic API error ${res.statusCode}: ${d.slice(0, 300)}`))
            return
          }
          try { resolve(JSON.parse(d)) }
          catch { reject(new Error(`Anthropic invalid JSON: ${d.slice(0, 200)}`)) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic timeout')) })
      req.write(JSON.stringify(body))
      req.end()
    })
  }
}
