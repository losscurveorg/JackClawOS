import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HumanInLoopManager } from '../src/human-in-loop'

describe('HumanInLoopManager', () => {
  it('requests a review and returns requestId', async () => {
    const hil = new HumanInLoopManager()
    const requestId = await hil.requestReview({
      trigger: 'high_stakes',
      nodeId: 'alice',
      description: 'Deploy to production',
      context: { target: 'prod' },
      options: [
        { id: 'approve', label: 'Approve', consequence: 'Deploy goes live', risk: 'high' },
        { id: 'reject', label: 'Reject', consequence: 'Deploy cancelled', risk: 'low' },
      ],
      defaultOnTimeout: 'reject',
    })
    assert.ok(requestId)
    assert.equal(typeof requestId, 'string')
  })

  it('resolves a review with valid token', async () => {
    const hil = new HumanInLoopManager()
    const requestId = await hil.requestReview({
      trigger: 'manual',
      nodeId: 'bob',
      description: 'Test review',
      context: {},
      options: [{ id: 'ok', label: 'OK', consequence: 'Nothing', risk: 'low' }],
      defaultOnTimeout: 'approve',
    })

    const token = hil.generateHumanToken(requestId)
    await hil.resolve(requestId, 'ok', token)
    // After resolve, it should be removed from pending
    const pending = await hil.getPending()
    const found = pending.find(p => p.requestId === requestId)
    // Resolved requests are either removed or marked
    assert.ok(!found || found.resolvedAt)
  })

  it('rejects unknown request resolution', async () => {
    const hil = new HumanInLoopManager()
    await assert.rejects(
      () => hil.resolve('nonexistent', 'ok', 'bad-token'),
      { message: /not found/ },
    )
  })

  it('lists pending reviews', async () => {
    const hil = new HumanInLoopManager()
    await hil.requestReview({
      trigger: 'high_stakes', nodeId: 'alice',
      description: 'Deploy', context: {}, options: [],
      defaultOnTimeout: 'reject',
    })
    await hil.requestReview({
      trigger: 'manual', nodeId: 'bob',
      description: 'Manual check', context: {}, options: [],
      defaultOnTimeout: 'approve',
    })
    const pending = await hil.getPending()
    assert.equal(pending.length, 2)
  })

  it('filters pending by nodeId', async () => {
    const hil = new HumanInLoopManager()
    await hil.requestReview({
      trigger: 'high_stakes', nodeId: 'alice',
      description: 'Deploy', context: {}, options: [],
      defaultOnTimeout: 'reject',
    })
    await hil.requestReview({
      trigger: 'manual', nodeId: 'bob',
      description: 'Test', context: {}, options: [],
      defaultOnTimeout: 'approve',
    })
    const aliceOnly = await hil.getPending('alice')
    assert.equal(aliceOnly.length, 1)
    assert.equal(aliceOnly[0].nodeId, 'alice')
  })

  it('shouldRequireHuman for high-stakes at L1', async () => {
    const hil = new HumanInLoopManager()
    hil.setNodeAutonomyLevel('alice', 1)
    // shouldRequireHuman signature: (action, nodeId, targetNodeId?)
    const needsReview = await hil.shouldRequireHuman('delete', 'alice')
    assert.equal(needsReview, true)
  })

  it('shouldRequireHuman false for read at L1', async () => {
    const hil = new HumanInLoopManager()
    hil.setNodeAutonomyLevel('alice', 1)
    const noReview = await hil.shouldRequireHuman('read', 'alice')
    assert.equal(noReview, false)
  })

  it('L3 allows everything', async () => {
    const hil = new HumanInLoopManager()
    hil.setNodeAutonomyLevel('alice', 3)
    const noReview = await hil.shouldRequireHuman('delete', 'alice')
    assert.equal(noReview, false)
  })

  it('generates human token', async () => {
    const hil = new HumanInLoopManager()
    const requestId = await hil.requestReview({
      trigger: 'manual', nodeId: 'test',
      description: 'Token test', context: {}, options: [],
      defaultOnTimeout: 'reject',
    })
    const token = hil.generateHumanToken(requestId)
    assert.ok(token)
    assert.equal(typeof token, 'string')
    assert.ok(token.length > 10)
  })
})
