import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Import EventBus directly (source)
import { EventBus } from '../src/event-bus'

describe('EventBus', () => {
  it('emits to exact pattern subscribers', () => {
    const bus = new EventBus()
    const received: string[] = []
    bus.on('msg.received', (e) => { received.push(e.type) })
    bus.emit('msg.received', { text: 'hello' })
    bus.emit('msg.sent', { text: 'bye' })
    assert.deepEqual(received, ['msg.received'])
  })

  it('supports wildcard "msg.*" pattern', () => {
    const bus = new EventBus()
    const received: string[] = []
    bus.on('msg.*', (e) => { received.push(e.type) })
    bus.emit('msg.received', {})
    bus.emit('msg.sent', {})
    bus.emit('user.online', {})
    assert.deepEqual(received, ['msg.received', 'msg.sent'])
  })

  it('supports catch-all "*" pattern', () => {
    const bus = new EventBus()
    let count = 0
    bus.on('*', () => { count++ })
    bus.emit('msg.received', {})
    bus.emit('user.online', {})
    bus.emit('task.created', {})
    assert.equal(count, 3)
  })

  it('unsubscribes by id', () => {
    const bus = new EventBus()
    let count = 0
    const id = bus.on('test', () => { count++ })
    bus.emit('test', {})
    assert.equal(count, 1)
    const removed = bus.off(id)
    assert.equal(removed, true)
    bus.emit('test', {})
    assert.equal(count, 1) // still 1
  })

  it('removes all subscriptions for a plugin', () => {
    const bus = new EventBus()
    let countA = 0
    let countB = 0
    bus.on('test', () => { countA++ }, 'pluginA')
    bus.on('test', () => { countB++ }, 'pluginB')
    bus.on('other', () => { countA++ }, 'pluginA')
    bus.emit('test', {})
    assert.equal(countA, 1)
    assert.equal(countB, 1)
    const removed = bus.offPlugin('pluginA')
    assert.equal(removed, 2) // removed 2 subscriptions
    bus.emit('test', {})
    bus.emit('other', {})
    assert.equal(countA, 1) // unchanged
    assert.equal(countB, 2) // still active
  })

  it('catches handler errors without propagating', () => {
    const bus = new EventBus()
    let reached = false
    bus.on('test', () => { throw new Error('boom') })
    bus.on('test', () => { reached = true })
    bus.emit('test', {})
    assert.equal(reached, true) // second handler still runs
  })

  it('tracks subscription count', () => {
    const bus = new EventBus()
    assert.equal(bus.subscriptionCount, 0)
    bus.on('a', () => {})
    bus.on('b', () => {})
    bus.on('c.*', () => {})
    assert.equal(bus.subscriptionCount, 3)
  })

  it('stores recent events', () => {
    const bus = new EventBus()
    bus.emit('a', { v: 1 })
    bus.emit('b', { v: 2 })
    const recent = bus.getRecentEvents(10)
    assert.equal(recent.length, 2)
    assert.equal(recent[0].type, 'a')
    assert.equal(recent[1].type, 'b')
  })

  it('includes source in events', () => {
    const bus = new EventBus()
    let source: string | undefined
    bus.on('test', (e) => { source = e.source })
    bus.emit('test', {}, 'my-plugin')
    assert.equal(source, 'my-plugin')
  })
})
