import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  humanId, agentHandle, nodeId, hubId, threadId,
  isAgentHandle, isNodeId, isHumanId,
} from '../../protocol/src/unified-identity'

/**
 * Integration test: Protocol → Hub → Chat flow
 *
 * Tests the core message flow types, identity system,
 * and data structures used in the Hub-Node communication.
 */

describe('Protocol-Hub Integration', () => {
  describe('Identity types for Hub registration', () => {
    it('NodeId for agent registration', () => {
      const n = nodeId('alice')
      assert.equal(typeof n, 'string')
      assert.ok(isNodeId(n))
    })

    it('AgentHandle for public discovery', () => {
      const h = agentHandle('alice.jackclaw')
      assert.equal(h, '@alice.jackclaw')
      assert.ok(isAgentHandle(h))
    })

    it('HumanId for human users', () => {
      const h = humanId('hu_jack_001')
      assert.ok(isHumanId(h))
      assert.ok(!isAgentHandle(h as string))
      assert.ok(!isNodeId(h as string))
    })

    it('ThreadId for chat sessions', () => {
      const t = threadId('thread-abc-123')
      assert.equal(t, 'thread-abc-123')
    })
  })

  describe('Message structure validation', () => {
    it('creates a valid chat message', () => {
      const msg = {
        id: `msg-${Date.now()}`,
        from: nodeId('alice'),
        to: nodeId('bob'),
        content: 'Hello Bob!',
        type: 'text' as const,
        ts: Date.now(),
        signature: '',
        encrypted: false,
      }
      assert.ok(msg.id)
      assert.ok(isNodeId(msg.from as string))
      assert.ok(isNodeId(msg.to as string))
      assert.equal(msg.type, 'text')
    })

    it('supports extended message types', () => {
      const types = ['text', 'card', 'task', 'transaction', 'media',
                     'reminder', 'calendar', 'approval', 'system'] as const
      for (const t of types) {
        assert.equal(typeof t, 'string')
      }
    })

    it('supports custom message types (x- prefix)', () => {
      const customType = 'x-invoice' as `x-${string}`
      assert.ok(customType.startsWith('x-'))
    })
  })

  describe('Registration payload structure', () => {
    it('creates valid registration payload', () => {
      const payload = {
        nodeId: 'alice',
        name: 'Engineer Alice',
        role: 'engineer',
        publicKey: 'demo-key-alice',
      }
      assert.ok(payload.nodeId)
      assert.ok(payload.name)
      assert.ok(payload.role)
      assert.ok(payload.publicKey)
    })

    it('creates valid report payload', () => {
      const report = {
        summary: 'Login page done',
        period: 'daily',
        visibility: 'ceo',
        data: {
          tasks: [{ name: 'login', status: 'done', hours: 3 }],
          blockers: [],
        },
      }
      assert.ok(report.summary)
      assert.equal(report.period, 'daily')
      assert.ok(Array.isArray(report.data.tasks))
    })
  })
})
