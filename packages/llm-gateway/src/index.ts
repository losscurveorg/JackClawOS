/**
 * @jackclaw/llm-gateway
 *
 * Universal LLM gateway — connect any AI model to your JackClaw nodes.
 *
 * Supported providers (out of the box):
 * - OpenAI (GPT-4o, GPT-4o-mini, o1, o3)
 * - Anthropic (Claude Opus, Sonnet, Haiku)
 * - Google (Gemini 2.0 Flash, 1.5 Pro)
 * - DeepSeek (deepseek-chat, deepseek-reasoner)
 * - Groq (Llama 3.3, Mixtral)
 * - Ollama (local: llama3, mistral, qwen2.5, any)
 * - OpenRouter (200+ models via one API)
 * - Any OpenAI-compatible endpoint
 *
 * @example
 * ```ts
 * import { createGateway } from '@jackclaw/llm-gateway'
 *
 * const gw = createGateway({
 *   openai:    { apiKey: process.env.OPENAI_API_KEY },
 *   anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
 *   google:    { apiKey: process.env.GOOGLE_API_KEY },
 *   deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY },
 *   groq:      { apiKey: process.env.GROQ_API_KEY },
 *   ollama:    { baseUrl: 'http://localhost:11434' },
 * })
 *
 * // Auto-route: picks the right provider by model name
 * const reply = await gw.chat({ model: 'gpt-4o', messages: [...] })
 * const fast  = await gw.fast('Summarize this in 3 bullets: ...')
 * const smart = await gw.smart('Analyze this code: ...')
 * const free  = await gw.local('What is 2+2?', 'llama3')
 * ```
 */

export type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ChatMessage, ChatChoice, TokenUsage, ToolCall, ToolDefinition,
  GatewayConfig, ProviderConfig, Role,
} from './types.js'

export { LLMGateway } from './gateway.js'
export type { GatewayStats } from './gateway.js'
export { OpenAICompatibleProvider } from './providers/openai-compatible.js'
export { AnthropicProvider } from './providers/anthropic.js'
export { GoogleProvider } from './providers/google.js'

// ─── Quick factory ───────────────────────────────────────────────────

export interface QuickConfig {
  openai?:      { apiKey: string; baseUrl?: string }
  anthropic?:   { apiKey: string; baseUrl?: string }
  google?:      { apiKey: string }
  deepseek?:    { apiKey: string }
  groq?:        { apiKey: string }
  mistral?:     { apiKey: string }
  together?:    { apiKey: string }
  openrouter?:  { apiKey: string }
  ollama?:      { baseUrl?: string; models?: string[] }
  /** Custom OpenAI-compatible endpoint */
  custom?:      { name: string; apiKey?: string; baseUrl: string; defaultModel?: string }
  /** Default provider for unknown models */
  defaultProvider?: string
  /** Fallback chain */
  fallbackChain?: string[]
}

import { LLMGateway } from './gateway.js'
import type { GatewayConfig, ProviderConfig } from './types.js'

export function createGateway(config: QuickConfig): LLMGateway {
  const providers: ProviderConfig[] = []

  if (config.openai) {
    providers.push({
      provider: 'openai',
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl ?? 'https://api.openai.com',
      defaultModel: 'gpt-4o',
    })
  }

  if (config.anthropic) {
    providers.push({
      provider: 'anthropic',
      apiKey: config.anthropic.apiKey,
      baseUrl: config.anthropic.baseUrl ?? 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-6',
    })
  }

  if (config.google) {
    providers.push({
      provider: 'google',
      apiKey: config.google.apiKey,
      defaultModel: 'gemini-2.0-flash',
    })
  }

  if (config.deepseek) {
    providers.push({
      provider: 'deepseek',
      apiKey: config.deepseek.apiKey,
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
    })
  }

  if (config.groq) {
    providers.push({
      provider: 'groq',
      apiKey: config.groq.apiKey,
      baseUrl: 'https://api.groq.com/openai',
      defaultModel: 'llama-3.3-70b-versatile',
    })
  }

  if (config.mistral) {
    providers.push({
      provider: 'mistral',
      apiKey: config.mistral.apiKey,
      baseUrl: 'https://api.mistral.ai',
      defaultModel: 'mistral-large-latest',
    })
  }

  if (config.together) {
    providers.push({
      provider: 'together',
      apiKey: config.together.apiKey,
      baseUrl: 'https://api.together.xyz',
      defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    })
  }

  if (config.openrouter) {
    providers.push({
      provider: 'openrouter',
      apiKey: config.openrouter.apiKey,
      baseUrl: 'https://openrouter.ai/api',
      defaultModel: 'openai/gpt-4o',
    })
  }

  if (config.ollama) {
    providers.push({
      provider: 'ollama',
      baseUrl: config.ollama.baseUrl ?? 'http://localhost:11434',
      defaultModel: config.ollama.models?.[0] ?? 'llama3',
      models: { ...(config.ollama.models?.reduce((a, m) => ({ ...a, [m]: m }), {})) },
    })
  }

  if (config.custom) {
    providers.push({
      provider: config.custom.name,
      apiKey: config.custom.apiKey,
      baseUrl: config.custom.baseUrl,
      defaultModel: config.custom.defaultModel,
    })
  }

  if (!providers.length) {
    throw new Error('[createGateway] No providers configured. Pass at least one API key.')
  }

  const gwConfig: GatewayConfig = {
    providers,
    defaultProvider: config.defaultProvider ?? providers[0].provider,
    fallbackChain: config.fallbackChain,
  }

  return new LLMGateway(gwConfig)
}
