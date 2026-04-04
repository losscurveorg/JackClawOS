import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PluginManager } from '../src/plugin-manager'
import type { JackClawPlugin, PluginAPI } from '../src/plugin-manager'

function makePlugin(name: string, initFn?: (api: PluginAPI) => void): JackClawPlugin {
  return {
    manifest: { name, version: '1.0.0', description: `Test plugin ${name}` },
    init(api) { initFn?.(api) },
  }
}

describe('PluginManager', () => {
  it('loads a plugin', async () => {
    const pm = new PluginManager()
    let initialized = false
    const plugin = makePlugin('test-plugin', () => { initialized = true })
    await pm.load(plugin)
    assert.equal(initialized, true)
    assert.equal(pm.list().length, 1)
    assert.equal(pm.list()[0].name, 'test-plugin')
  })

  it('prevents duplicate loading', async () => {
    const pm = new PluginManager()
    await pm.load(makePlugin('dup'))
    await assert.rejects(() => pm.load(makePlugin('dup')), /already loaded/)
  })

  it('unloads a plugin', async () => {
    const pm = new PluginManager()
    let destroyed = false
    const plugin: JackClawPlugin = {
      manifest: { name: 'removable', version: '1.0.0', description: '' },
      init() {},
      destroy() { destroyed = true },
    }
    await pm.load(plugin)
    assert.equal(pm.list().length, 1)
    await pm.unload('removable')
    assert.equal(destroyed, true)
    assert.equal(pm.list().length, 0)
  })

  it('rejects unloading unknown plugin', async () => {
    const pm = new PluginManager()
    await assert.rejects(() => pm.unload('ghost'), /not loaded/)
  })

  it('provides sandboxed API with store', async () => {
    const pm = new PluginManager()
    let storeApi: PluginAPI['store'] | undefined
    await pm.load(makePlugin('store-test', (api) => {
      storeApi = api.store
      api.store.set('key1', 'value1')
    }))
    assert.ok(storeApi)
    assert.equal(storeApi.get('key1'), 'value1')
    storeApi.delete('key1')
    assert.equal(storeApi.get('key1'), undefined)
  })

  it('provides config access', async () => {
    const pm = new PluginManager()
    pm.setConfig('cfg-test', { maxItems: 42 })
    let configVal: unknown
    await pm.load(makePlugin('cfg-test', (api) => {
      configVal = api.getConfig('maxItems', 10)
    }))
    assert.equal(configVal, 42)
  })

  it('returns default config for missing keys', async () => {
    const pm = new PluginManager()
    let configVal: unknown
    await pm.load(makePlugin('no-cfg', (api) => {
      configVal = api.getConfig('missing', 'default')
    }))
    assert.equal(configVal, 'default')
  })

  it('provides event subscription via API', async () => {
    const pm = new PluginManager()
    let subId: string | undefined
    await pm.load(makePlugin('evt-test', (api) => {
      subId = api.on('test.event', () => {})
    }))
    assert.ok(subId)
    assert.ok(subId.startsWith('sub_'))
  })

  it('reports stats correctly', async () => {
    const pm = new PluginManager()
    await pm.load(makePlugin('a'))
    await pm.load(makePlugin('b'))
    const stats = pm.getStats()
    assert.equal(stats.totalPlugins, 2)
    assert.deepEqual(stats.pluginNames.sort(), ['a', 'b'])
  })

  it('handles init failure gracefully', async () => {
    const pm = new PluginManager()
    const bad: JackClawPlugin = {
      manifest: { name: 'bad', version: '1.0.0', description: '' },
      init() { throw new Error('init exploded') },
    }
    await assert.rejects(() => pm.load(bad), /init failed/)
    assert.equal(pm.list().length, 0) // not loaded
  })
})
