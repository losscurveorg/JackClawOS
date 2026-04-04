/**
 * @jackclaw/llm-gateway — Universal LLM types
 *
 * All providers conform to these interfaces so Nodes can
 * switch models without changing any business logic.
 */

// ─── Chat Messages ──────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// ─── Request / Response ─────────────────────────────────────────────

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  top_p?: number
  stop?: string[]
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  stream?: boolean
  json_mode?: boolean
  /** Provider-specific overrides (passed through) */
  extra?: Record<string, unknown>
}

export interface ChatResponse {
  id: string
  model: string
  provider: string
  choices: ChatChoice[]
  usage: TokenUsage
  /** Milliseconds from request to first byte */
  latencyMs: number
  /** Raw provider response (for debugging) */
  raw?: unknown
}

export interface ChatChoice {
  index: number
  message: ChatMessage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// ─── Streaming ──────────────────────────────────────────────────────

export interface ChatStreamDelta {
  id: string
  model: string
  provider: string
  choices: Array<{
    index: number
    delta: Partial<ChatMessage>
    finish_reason: string | null
  }>
}

// ─── Provider Interface ─────────────────────────────────────────────

export interface LLMProvider {
  name: string
  /** 'cloud' = remote API, 'local' = runs on-device (Ollama, MLX, etc.) */
  type: 'cloud' | 'local'
  /** Model IDs this provider supports (static list; use getModels() for live list) */
  models: string[]
  /** Send a chat completion request */
  chat(request: ChatRequest): Promise<ChatResponse>
  /** Stream a chat completion (yields deltas) */
  chatStream?(request: ChatRequest): AsyncIterable<ChatStreamDelta>
  /**
   * Stream text tokens as plain strings — simplified API for chat UIs.
   * Yields each text chunk as it arrives.
   */
  stream?(messages: ChatMessage[], options?: Partial<ChatRequest>): AsyncGenerator<string>
  /** Whether this provider is currently reachable */
  isAvailable(): Promise<boolean>
  /** Live model list (may differ from static `models` array for local providers) */
  getModels(): Promise<string[]>
  /** @deprecated use isAvailable() */
  ping(): Promise<boolean>
}

// ─── Gateway Config ─────────────────────────────────────────────────

export interface ProviderConfig {
  provider: string
  apiKey?: string
  baseUrl?: string
  /** Model aliases: e.g. { "fast": "gpt-4o-mini", "smart": "gpt-4o" } */
  models?: Record<string, string>
  /** Default model for this provider */
  defaultModel?: string
  /** Max concurrent requests */
  concurrency?: number
  /** Request timeout in ms */
  timeoutMs?: number
  /** Extra headers */
  headers?: Record<string, string>
}

export interface GatewayConfig {
  providers: ProviderConfig[]
  /** Default provider name */
  defaultProvider?: string
  /** Fallback chain: try providers in order */
  fallbackChain?: string[]
  /** Route rules: model pattern → provider */
  routing?: Array<{ pattern: string; provider: string }>
  /** Gateway-level request timeout in ms (default 30000) */
  timeoutMs?: number
  /** Max retry attempts for network errors (default 3) */
  maxRetries?: number
}
