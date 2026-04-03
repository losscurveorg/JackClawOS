/**
 * HarnessRegistry — 自动探测 + 管理所有可用 Harness Adapter
 *
 * 使用方式：
 *   const registry = new HarnessRegistry()
 *   await registry.init()                    // 探测所有已安装工具
 *   const session = registry.spawn('codex', task, context)
 *   const result = await session.run()
 *
 *   // 或者：自动选最优可用工具
 *   const session = registry.spawnBest(task, context)
 */

import type { HarnessAdapter, HarnessTask, HarnessName } from './adapter'
import type { HarnessContext } from './context'
import { JackClawSession } from './session'
import { CodexAdapter } from './adapters/codex'
import { ClaudeCodeAdapter } from './adapters/claude-code'
import { OpenCodeAdapter } from './adapters/opencode'

// 优先级顺序（数字小 = 优先）
const ADAPTER_PRIORITY: HarnessName[] = ['claude-code', 'codex', 'opencode']

export class HarnessRegistry {
  private adapters: Map<HarnessName, HarnessAdapter> = new Map()
  private available: Set<HarnessName> = new Set()

  constructor() {
    // 注册所有内置 adapter
    const builtin: HarnessAdapter[] = [
      new ClaudeCodeAdapter(),
      new CodexAdapter(),
      new OpenCodeAdapter(),
    ]
    for (const adapter of builtin) {
      this.adapters.set(adapter.name, adapter)
    }
  }

  /** 注册自定义 Adapter */
  register(adapter: HarnessAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  /** 探测哪些工具已安装（启动时调用一次） */
  async init(): Promise<void> {
    const checks = [...this.adapters.entries()].map(async ([name, adapter]) => {
      const ok = await adapter.isAvailable().catch(() => false)
      if (ok) this.available.add(name)
      console.log(`[harness] ${name}: ${ok ? '✅ available' : '❌ not found'}`)
    })
    await Promise.all(checks)
  }

  /** 获取可用工具列表 */
  getAvailable(): HarnessName[] {
    return ADAPTER_PRIORITY.filter(n => this.available.has(n))
  }

  /** 用指定工具 spawn */
  spawn(name: HarnessName, task: HarnessTask, context: HarnessContext): JackClawSession {
    const adapter = this.adapters.get(name)
    if (!adapter) throw new Error(`Harness adapter not found: ${name}`)
    if (!this.available.has(name)) throw new Error(`Harness not available: ${name} (not installed?)`)
    return new JackClawSession(adapter, task, context)
  }

  /**
   * 自动选最优可用工具 spawn
   * 优先级：claude-code > codex > opencode > ...
   */
  spawnBest(task: HarnessTask, context: HarnessContext): JackClawSession {
    const best = this.getAvailable()[0]
    if (!best) throw new Error('No harness available. Install codex, claude, or opencode.')
    console.log(`[harness] Auto-selected: ${best}`)
    return this.spawn(best, task, context)
  }
}

// 全局单例
let _registry: HarnessRegistry | null = null
export async function getHarnessRegistry(): Promise<HarnessRegistry> {
  if (!_registry) {
    _registry = new HarnessRegistry()
    await _registry.init()
  }
  return _registry
}
