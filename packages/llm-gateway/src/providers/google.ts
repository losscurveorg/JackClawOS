/**
 * Google Gemini provider — Gemini 2.0, 1.5 Pro, Flash
 *
 * Uses Google Generative Language API (generateContent).
 */
import https from 'https'
import http from 'http'
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ProviderConfig, TokenUsage
} from '../types.js'

export class GoogleProvider implements LLMProvider {
  name = 'google'
  models: string[]
  private apiKey: string
  private baseUrl: string
  private timeoutMs: number

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? ''
    this.baseUrl = (config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? 120000
    this.models = Object.values(config.models ?? {})
    if (config.defaultModel && !this.models.includes(config.defaultModel)) {
      this.models.push(config.defaultModel)
    }
    if (!this.models.length) this.models = ['gemini-2.0-flash', 'gemini-1.5-pro']
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const start = Date.now()
    const model = request.model
    const body = this.buildBody(request)
    const path = `/v1beta/models/${model}:generateContent?key=${this.apiKey}`
    const data = await this.post(path, body)

    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('')

    return {
      id: `gemini-${Date.now()}`,
      model,
      provider: this.name,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: candidate?.finishReason === 'STOP' ? 'stop'
          : candidate?.finishReason === 'MAX_TOKENS' ? 'length'
          : candidate?.finishReason ?? 'stop',
      }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      } as TokenUsage,
      latencyMs: Date.now() - start,
      raw: data,
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.chat({
        model: this.models[0] ?? 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      })
      return true
    } catch { return false }
  }

  private buildBody(request: ChatRequest): Record<string, unknown> {
    // Convert OpenAI-style messages to Gemini contents
    const systemParts: any[] = []
    const contents: any[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content })
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })
      }
    }

    const body: Record<string, unknown> = { contents }

    if (systemParts.length) {
      body.systemInstruction = { parts: systemParts }
    }

    const genConfig: Record<string, unknown> = {}
    if (request.max_tokens) genConfig.maxOutputTokens = request.max_tokens
    if (request.temperature !== undefined) genConfig.temperature = request.temperature
    if (request.top_p !== undefined) genConfig.topP = request.top_p
    if (request.stop) genConfig.stopSequences = request.stop
    if (Object.keys(genConfig).length) body.generationConfig = genConfig

    if (request.json_mode) {
      (body.generationConfig as any).responseMimeType = 'application/json'
    }

    return body
  }

  private post(path: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeoutMs,
      }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Google API error ${res.statusCode}: ${d.slice(0, 300)}`))
            return
          }
          try { resolve(JSON.parse(d)) }
          catch { reject(new Error(`Google invalid JSON`)) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Google timeout')) })
      req.write(JSON.stringify(body))
      req.end()
    })
  }
}
