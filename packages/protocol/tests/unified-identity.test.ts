import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  humanId, agentHandle, nodeId, hubId, threadId,
  isAgentHandle, isNodeId, isHumanId,
  type HumanId, type AgentHandle, type NodeId, type HubId, type ThreadId,
} from '../src/unified-identity'

describe('Unified Identity — Constructors', () => {
  it('creates HumanId from valid string', () => {
    const h = humanId('hu_abc123')
    assert.equal(h, 'hu_abc123')
  })

  it('rejects HumanId starting with @', () => {
    assert.throws(() => humanId('@alice'), /Invalid HumanId/)
  })

  it('rejects HumanId starting with node-', () => {
    assert.throws(() => humanId('node-123'), /Invalid HumanId/)
  })

  it('rejects HumanId starting with hub-', () => {
    assert.throws(() => humanId('hub-prod'), /Invalid HumanId/)
  })

  it('rejects empty HumanId', () => {
    assert.throws(() => humanId(''), /Invalid HumanId/)
  })

  it('creates AgentHandle with @ prefix', () => {
    const h = agentHandle('alice.jackclaw')
    assert.equal(h, '@alice.jackclaw')
  })

  it('keeps existing @ prefix', () => {
    const h = agentHandle('@bob')
    assert.equal(h, '@bob')
  })

  it('creates NodeId', () => {
    const n = nodeId('node-7f3a')
    assert.equal(n, 'node-7f3a')
  })

  it('creates HubId', () => {
    const h = hubId('hub-prod-01')
    assert.equal(h, 'hub-prod-01')
  })

  it('creates ThreadId', () => {
    const t = threadId('thread-uuid-123')
    assert.equal(t, 'thread-uuid-123')
  })
})

describe('Unified Identity — Type Guards', () => {
  it('isAgentHandle detects @ prefix', () => {
    assert.equal(isAgentHandle('@alice'), true)
    assert.equal(isAgentHandle('alice'), false)
    assert.equal(isAgentHandle('hu_123'), false)
  })

  it('isHumanId detects hu_ prefix', () => {
    assert.equal(isHumanId('hu_abc'), true)
    assert.equal(isHumanId('@alice'), false)
    assert.equal(isHumanId('node-1'), false)
  })

  it('isNodeId excludes other prefixes', () => {
    assert.equal(isNodeId('node-7f3a'), true)
    assert.equal(isNodeId('my-agent'), true)
    assert.equal(isNodeId('@alice'), false)
    assert.equal(isNodeId('hu_123'), false)
    assert.equal(isNodeId('hub-prod'), false)
    assert.equal(isNodeId('thread-1'), false)
  })
})

describe('Unified Identity — Branded type safety', () => {
  it('branded types are strings at runtime', () => {
    const h: HumanId = humanId('hu_test')
    const a: AgentHandle = agentHandle('alice')
    const n: NodeId = nodeId('node-1')
    assert.equal(typeof h, 'string')
    assert.equal(typeof a, 'string')
    assert.equal(typeof n, 'string')
  })

  it('string operations work on branded types', () => {
    const h = agentHandle('alice')
    assert.ok(h.startsWith('@'))
    assert.equal(h.length, 6) // @alice
    assert.equal(h.toUpperCase(), '@ALICE')
  })
})
