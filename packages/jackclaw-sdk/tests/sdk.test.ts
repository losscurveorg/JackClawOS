import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  definePlugin,
  defineNode,
  createMockCommandContext,
  createMockScheduleContext,
} from '../src/index'

describe('SDK — definePlugin', () => {
  it('returns the same definition object', () => {
    const def = definePlugin({
      name: 'test-plugin',
      version: '0.1.0',
      commands: {
        ping: async () => ({ text: 'pong' }),
      },
    })
    assert.equal(def.name, 'test-plugin')
    assert.equal(def.version, '0.1.0')
    assert.ok(def.commands?.ping)
  })

  it('supports events and schedules', () => {
    const def = definePlugin({
      name: 'full-plugin',
      version: '1.0.0',
      commands: {
        status: async (ctx) => ({ text: `OK from ${ctx.node.name}` }),
      },
      events: {
        'message:send': async () => {},
      },
      schedules: {
        daily: {
          cron: '0 9 * * *',
          handler: async () => {},
        },
      },
    })
    assert.ok(def.events?.['message:send'])
    assert.ok(def.schedules?.daily)
    assert.equal(def.schedules?.daily.cron, '0 9 * * *')
  })

  it('command handler returns CommandResult', async () => {
    const def = definePlugin({
      name: 'cmd-test',
      version: '0.1.0',
      commands: {
        hello: async () => ({
          text: 'Hello!',
          items: [{ label: 'Status', value: 'OK' }],
        }),
      },
    })
    const ctx = createMockCommandContext()
    const result = await def.commands!.hello(ctx)
    assert.equal(result.text, 'Hello!')
    assert.ok(result.items)
    assert.equal(result.items!.length, 1)
  })
})

describe('SDK — defineNode', () => {
  it('returns the same definition', () => {
    const node = defineNode({
      name: 'alice',
      version: '0.2.0',
      role: 'engineer',
    })
    assert.equal(node.name, 'alice')
    assert.equal(node.role, 'engineer')
  })
})

describe('SDK — Mock Contexts', () => {
  it('createMockCommandContext returns usable context', () => {
    const ctx = createMockCommandContext()
    assert.ok(ctx.node)
    assert.ok(ctx.node.name)
    assert.ok(ctx.plugin)
  })

  it('createMockScheduleContext returns usable context', () => {
    const ctx = createMockScheduleContext()
    assert.ok(ctx.node)
    assert.ok(ctx.report)
    assert.equal(typeof ctx.report, 'function')
  })
})
