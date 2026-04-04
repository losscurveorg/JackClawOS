/**
 * LLM Gateway — Unified config management
 *
 * Reads/writes ~/.jackclaw/llm-config.json
 *
 * Format:
 * {
 *   "defaultProvider": "ollama",
 *   "defaultModel": "qwen2.5:7b",
 *   "fallbackChain": ["ollama", "deepseek", "anthropic"],
 *   "providers": {
 *     "ollama":    { "baseUrl": "http://localhost:11434" },
 *     "anthropic": { "apiKey": "sk-ant-..." },
 *     "openai":    { "apiKey": "sk-...", "baseUrl": "https://api.openai.com" },
 *     "deepseek":  { "apiKey": "..." },
 *     "qwen":      { "apiKey": "...", "localModel": "qwen2.5-7b-mlx" }
 *   }
 * }
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMProviderEntry {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  /** For Qwen: name of a local MLX or Ollama model to prefer */
  localModel?: string
  enabled?: boolean
}

export interface LLMConfig {
  defaultProvider: string
  defaultModel?: string
  /** Ordered fallback list — tried in sequence when primary fails */
  fallbackChain: string[]
  providers: Record<string, LLMProviderEntry>
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.jackclaw')
const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json')

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: LLMConfig = {
  defaultProvider: 'anthropic',
  fallbackChain: ['anthropic'],
  providers: {
    ollama: { baseUrl: 'http://localhost:11434' },
  },
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load config from disk, merging with defaults. Never throws. */
export function loadLLMConfig(): LLMConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LLMConfig>
    return {
      ...DEFAULTS,
      ...parsed,
      providers: { ...DEFAULTS.providers, ...(parsed.providers ?? {}) },
      fallbackChain: parsed.fallbackChain ?? DEFAULTS.fallbackChain,
    }
  } catch {
    return { ...DEFAULTS, providers: { ...DEFAULTS.providers } }
  }
}

/** Persist config to disk. */
export function saveLLMConfig(config: LLMConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Set a dot-path value in the LLM config.
 *
 * @example
 * setLLMConfigValue('llm.default', 'ollama/qwen2.5:7b')
 * setLLMConfigValue('providers.deepseek.apiKey', 'sk-...')
 */
export function setLLMConfigValue(keyPath: string, value: string): void {
  const config = loadLLMConfig()

  // Normalize: strip leading "llm." prefix if present
  const key = keyPath.replace(/^llm\./, '')

  if (key === 'default') {
    // "ollama/qwen2.5:7b" → defaultProvider=ollama, defaultModel=qwen2.5:7b
    const parts = value.split('/')
    config.defaultProvider = parts[0]
    if (parts[1]) config.defaultModel = parts[1]
  } else if (key === 'fallback') {
    config.fallbackChain = value.split(',').map(s => s.trim())
  } else if (key.startsWith('providers.')) {
    // e.g. providers.deepseek.apiKey
    const segments = key.replace('providers.', '').split('.')
    const providerName = segments[0]
    const field = segments[1]
    if (!config.providers[providerName]) config.providers[providerName] = {}
    if (field) {
      (config.providers[providerName] as any)[field] = value
    }
  } else {
    // Generic top-level key
    (config as any)[key] = value
  }

  saveLLMConfig(config)
}

/** Get a dot-path value from the LLM config. */
export function getLLMConfigValue(keyPath: string): unknown {
  const config = loadLLMConfig()
  const key = keyPath.replace(/^llm\./, '')

  if (key === 'default') {
    return config.defaultModel
      ? `${config.defaultProvider}/${config.defaultModel}`
      : config.defaultProvider
  }
  if (key === 'fallback') return config.fallbackChain.join(', ')

  const segments = key.split('.')
  let cur: any = config
  for (const seg of segments) {
    cur = cur?.[seg]
    if (cur === undefined) return undefined
  }
  return cur
}
