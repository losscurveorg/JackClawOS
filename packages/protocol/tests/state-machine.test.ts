/**
 * Tests for the 6-state message state machine (T1)
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageStatus, StatusTransition } from '../src/receipt'

describe('MessageStatus type', () => {
  it('accepts all 6 valid states', () => {
    const valid: MessageStatus[] = [
      'accepted', 'sent', 'acked', 'stored', 'consumed', 'failed',
    ]
    assert.equal(valid.length, 6)
    for (const s of valid) {
      assert.ok(typeof s === 'string')
    }
  })

  it('StatusTransition has required fields', () => {
    const t: StatusTransition = {
      from: 'accepted',
      to: 'sent',
      ts: Date.now(),
      nodeId: 'node-a',
    }
    assert.equal(t.from, 'accepted')
    assert.equal(t.to, 'sent')
    assert.ok(t.ts > 0)
    assert.equal(t.nodeId, 'node-a')
  })

  it('duplicate status is valid', () => {
    const s: MessageStatus = 'duplicate'
    assert.equal(s, 'duplicate')
  })
})
