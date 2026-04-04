import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../src/context-store'

describe('ContextStore', () => {
  it('adds messages and retrieves context', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', 'Hello')
    store.addMessage('t1', 'assistant', 'Hi there')
    const ctx = store.getContextForLLM('t1')
    assert.equal(ctx.length, 2)
    assert.equal(ctx[0].role, 'user')
    assert.equal(ctx[1].role, 'assistant')
  })

  it('returns empty for unknown thread', () => {
    const store = new ContextStore()
    assert.deepEqual(store.getContextForLLM('unknown'), [])
  })

  it('signals when summary is needed', () => {
    const store = new ContextStore({ maxEntriesBeforeSummary: 3 })
    assert.equal(store.addMessage('t1', 'user', 'a'), false)
    assert.equal(store.addMessage('t1', 'user', 'b'), false)
    assert.equal(store.addMessage('t1', 'user', 'c'), true) // 3rd message triggers
  })

  it('applies summary and trims entries', () => {
    const store = new ContextStore({ maxRecentEntries: 2 })
    store.addMessage('t1', 'user', 'msg1')
    store.addMessage('t1', 'assistant', 'reply1')
    store.addMessage('t1', 'user', 'msg2')
    store.addMessage('t1', 'assistant', 'reply2')
    store.addMessage('t1', 'user', 'msg3')

    store.applySummary('t1', 'User asked about msgs 1-3, assistant replied.')

    const ctx = store.getContextForLLM('t1')
    // Should have: summary + last 2 entries
    assert.equal(ctx[0].role, 'system')
    assert.ok(ctx[0].content.includes('summary'))
    assert.equal(ctx.length, 3) // summary + 2 recent
  })

  it('estimates tokens for Chinese text', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', '你好世界')
    const estimate = store.getTokenEstimate('t1')
    assert.ok(estimate > 0)
    assert.ok(estimate <= 4) // 4 Chinese chars ≈ 2 tokens
  })

  it('estimates tokens for English text', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', 'Hello World')
    const estimate = store.getTokenEstimate('t1')
    assert.ok(estimate > 0)
    assert.ok(estimate <= 5) // ~11 chars / 4 ≈ 3 tokens
  })

  it('tracks stats correctly', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', 'a')
    store.addMessage('t1', 'user', 'b')
    const stats = store.getStats('t1')
    assert.ok(stats)
    assert.equal(stats.totalMessages, 2)
    assert.equal(stats.currentEntries, 2)
    assert.equal(stats.hasSummary, false)
  })

  it('clears thread context', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', 'hello')
    store.clear('t1')
    assert.equal(store.getStats('t1'), null)
    assert.deepEqual(store.getContextForLLM('t1'), [])
  })

  it('global stats aggregates across threads', () => {
    const store = new ContextStore()
    store.addMessage('t1', 'user', 'a')
    store.addMessage('t2', 'user', 'b')
    store.addMessage('t2', 'user', 'c')
    const g = store.globalStats()
    assert.equal(g.activeThreads, 2)
    assert.equal(g.totalEntries, 3)
    assert.ok(g.totalTokens > 0)
  })
})
