/**
 * ProcessWatcher — Hub / Node 进程守护
 *
 * 功能：
 *  - 监控子进程，崩溃时自动重启
 *  - 最多 5 次 / 小时；超限后告警并停止重启（等待人工介入）
 *  - stdout / stderr 同时写入 LogWriter（~/.jackclaw/logs/）
 */

import { ChildProcess, spawn } from 'child_process'
import chalk from 'chalk'
import { LogWriter } from './log-writer'

const MAX_RESTARTS_PER_HOUR = 5
const ONE_HOUR_MS = 60 * 60 * 1000
const RESTART_DELAY_MS = 2_000

export type ServiceLabel = 'hub' | string // node / node-1 / node-2 …

export interface ProcessConfig {
  label: ServiceLabel
  script: string
  env?: Record<string, string>
  logWriter: LogWriter
  /** Called when restart limit is exceeded (hook for external alerting) */
  onOverLimit?: (label: ServiceLabel) => void
}

export class ProcessWatcher {
  private proc: ChildProcess | null = null
  private restartTimestamps: number[] = []
  private stopped = false

  constructor(private config: ProcessConfig) {}

  // ── Public ──────────────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false
    this.spawnProc()
  }

  stop(): void {
    this.stopped = true
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM')
      setTimeout(() => {
        if (this.proc && this.proc.exitCode === null) this.proc.kill('SIGKILL')
      }, 1_000).unref()
    }
  }

  /** Access the current underlying ChildProcess (may be null briefly during restart) */
  getProc(): ChildProcess | null {
    return this.proc
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private colorize(label: ServiceLabel): chalk.Chalk {
    if (label === 'hub') return chalk.blue
    if (label === 'node') return chalk.green
    // node-2, node-3 … cycle through colors
    const colors = [chalk.cyan, chalk.magenta, chalk.yellow, chalk.white]
    const n = parseInt(label.replace(/\D/g, '') || '0', 10)
    return colors[n % colors.length]
  }

  private spawnProc(): void {
    const { label, script, env, logWriter } = this.config
    const color = this.colorize(label)
    const prefix = color(`[${label}]`)

    const child = spawn('node', [script], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(l => l.trim()).forEach(l => {
        console.log(`${prefix} ${l}`)
        logWriter.write(`${new Date().toISOString()} ${l}`)
      })
    })

    child.stderr?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(l => l.trim()).forEach(l => {
        console.error(`${prefix} ${chalk.red(l)}`)
        logWriter.write(`${new Date().toISOString()} [ERROR] ${l}`)
      })
    })

    child.on('exit', (code, signal) => {
      if (this.stopped) return // intentional stop — do nothing

      const exitInfo = `exited code=${code ?? 'null'} signal=${signal ?? 'none'}`
      console.error(`${prefix} ${chalk.red(exitInfo)}`)
      logWriter.write(`${new Date().toISOString()} [CRASH] ${exitInfo}`)

      this.handleCrash()
    })

    this.proc = child
  }

  private handleCrash(): void {
    const now = Date.now()
    // Remove timestamps older than 1 hour
    this.restartTimestamps = this.restartTimestamps.filter(t => now - t < ONE_HOUR_MS)

    if (this.restartTimestamps.length >= MAX_RESTARTS_PER_HOUR) {
      const msg =
        `[ProcessWatcher] ${this.config.label} crashed ` +
        `${this.restartTimestamps.length + 1} times within the past hour. ` +
        `Restart limit (${MAX_RESTARTS_PER_HOUR}/hr) exceeded — manual intervention required.`
      console.error(chalk.red.bold(msg))
      this.config.logWriter.write(`${new Date().toISOString()} [ALERT] ${msg}`)
      this.config.onOverLimit?.(this.config.label)
      return
    }

    this.restartTimestamps.push(now)
    const used = this.restartTimestamps.length
    const remaining = MAX_RESTARTS_PER_HOUR - used
    const restartMsg =
      `[ProcessWatcher] Restarting ${this.config.label} in ${RESTART_DELAY_MS / 1000}s ` +
      `(${used}/${MAX_RESTARTS_PER_HOUR} this hour, ${remaining} remaining)`
    console.log(chalk.yellow(restartMsg))
    this.config.logWriter.write(`${new Date().toISOString()} [RESTART] ${restartMsg}`)

    setTimeout(() => {
      if (!this.stopped) this.spawnProc()
    }, RESTART_DELAY_MS)
  }
}
