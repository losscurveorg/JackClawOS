import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ModelRouter } from '../src/router'

// Mock provider
function mockProvider(name: string, type: 'cloud' | 'local' = 'cloud') {
  return {
    name,
    type,
    chat: async (req: any) => ({
      content: `Response from ${name}`,
      model: req.model ?? 'test-model',
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  } as any
}

describe('ModelRouter', () => {
  it('creates a router', () => {
    const router = new ModelRouter()
    assert.ok(router)
  })

  it('registers and retrieves providers', () => {
    const router = new ModelRouter()
    router.registerProvider(mockProvider('openai'))
    router.registerProvider(mockProvider('ollama', 'local'))
    const p = router.getProviderForModel('gpt-4o', 'openai')
    assert.equal(p.name, 'openai')
  })

  it('resolves provider from model prefix', () => {
    const router = new ModelRouter()
    router.registerProvider(mockProvider('ollama', 'local'))
    router.registerProvider(mockProvider('openai'))
    const p = router.getProviderForModel('ollama/qwen2.5:7b')
    assert.equal(p.name, 'ollama')
  })

  it('falls back to default provider', () => {
    const router = new ModelRouter()
    router.registerProvider(mockProvider('openai'))
    const p = router.getProviderForModel('unknown-model')
    assert.equal(p.name, 'openai')
  })

  it('routes a chat request', async () => {
    const router = new ModelRouter()
    router.registerProvider(mockProvider('openai'))
    const result = await router.route({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    assert.ok(result.content)
    assert.ok(result.content.includes('openai'))
  })

  it('sets fallback chain', () => {
    const router = new ModelRouter()
    router.registerProvider(mockProvider('openai'))
    router.registerProvider(mockProvider('anthropic'))
    router.setFallbackChain(['anthropic', 'openai'])
    // No throw
    assert.ok(true)
  })
})
