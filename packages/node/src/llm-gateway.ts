/**
 * createNodeGateway — Initialize LLM Gateway from Node config
 *
 * Reads enabled providers from config, returns a ready-to-use gateway.
 */
import type { JackClawConfig } from './config.js'
import { LLMGateway } from '@jackclaw/llm-gateway'
import type { GatewayConfig, ProviderConfig } from '@jackclaw/llm-gateway'

let _gateway: LLMGateway | null = null

export function createNodeGateway(config: JackClawConfig): LLMGateway {
  if (_gateway) return _gateway

  const providers: ProviderConfig[] = []
  const llm = config.llm

  for (const [name, pc] of Object.entries(llm.providers)) {
    if (!pc || !pc.enabled) continue

    // Ollama special: no apiKey needed
    if (name === 'ollama') {
      providers.push({
        provider: 'ollama',
        baseUrl: (pc as any).baseUrl ?? 'http://localhost:11434',
        defaultModel: pc.defaultModel ?? 'llama3',
      })
      continue
    }

    if (!pc.apiKey) continue // skip unconfigured

    const entry: ProviderConfig = {
      provider: name,
      apiKey: pc.apiKey,
      defaultModel: pc.defaultModel,
    }
    if (pc.baseUrl) entry.baseUrl = pc.baseUrl

    // Special base URLs for known providers
    if (name === 'deepseek' && !pc.baseUrl) entry.baseUrl = 'https://api.deepseek.com'
    if (name === 'groq'     && !pc.baseUrl) entry.baseUrl = 'https://api.groq.com/openai'
    if (name === 'mistral'  && !pc.baseUrl) entry.baseUrl = 'https://api.mistral.ai'
    if (name === 'together' && !pc.baseUrl) entry.baseUrl = 'https://api.together.xyz'
    if (name === 'openrouter' && !pc.baseUrl) entry.baseUrl = 'https://openrouter.ai/api'

    providers.push(entry)
  }

  if (!providers.length) {
    // Fallback: use the legacy ai config (single Anthropic-compatible endpoint)
    providers.push({
      provider: 'anthropic',
      apiKey: config.ai.authToken,
      baseUrl: config.ai.baseUrl,
      defaultModel: config.ai.model,
    })
  }

  const gwConfig: GatewayConfig = {
    providers,
    defaultProvider: llm.defaultProvider,
    fallbackChain: llm.fallbackChain.filter(p => providers.some(pr => pr.provider === p)),
  }

  _gateway = new LLMGateway(gwConfig)

  const active = providers.map(p => p.provider).join(', ')
  console.log(`[llm-gateway] Active providers: ${active}`)
  console.log(`[llm-gateway] Default: ${llm.defaultProvider} · Fallback: ${gwConfig.fallbackChain?.join(' → ')}`)

  return _gateway
}

export function getNodeGateway(): LLMGateway | null {
  return _gateway
}
