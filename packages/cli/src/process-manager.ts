/**
 * ProcessManager — centralized process lifecycle management
 *
 * PID files: ~/.jackclaw/pids/{name}.pid
 * Logs:      ~/.jackclaw/logs/{name}.log
 * Watchdog:  polls every 10s, auto-restarts crashed processes (max 5/hour)
 */

import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import chalk from 'chalk'

export const PIDS_DIR = path.join(os.homedir(), '.jackclaw', 'pids')
export const LOGS_DIR = path.join(os.homedir(), '.jackclaw', 'logs')

const MAX_RESTARTS_PER_HOUR = 5
const ONE_HOUR_MS = 60 * 60 * 1000
const WATCHDOG_INTERVAL_MS = 10_000
const SIGTERM_TIMEOUT_MS = 5_000
const RESTART_DELAY_MS = 2_000

export interface ProcessInfo {
  name: string
  pid: number | null
  running: boolean
  logPath: string
}

export interface StartOptions {
  env?: Record<string, string>
  cwd?: string
}

interface ManagedProcess {
  name: string
  command: string
  args: string[]
  opts: StartOptions
  proc: ChildProcess | null
  restartTimestamps: number[]
  stopped: boolean
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>()
  private watchdogTimer: NodeJS.Timeout | null = null

  constructor() {
    fs.mkdirSync(PIDS_DIR, { recursive: true })
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }

  // ── PID file helpers ────────────────────────────────────────────────────────

  pidFile(name: string): string {
    return path.join(PIDS_DIR, `${name}.pid`)
  }

  logFile(name: string): string {
    return path.join(LOGS_DIR, `${name}.log`)
  }

  private writePid(name: string, pid: number): void {
    fs.mkdirSync(PIDS_DIR, { recursive: true })
    fs.writeFileSync(this.pidFile(name), String(pid), 'utf8')
  }

  private readPid(name: string): number | null {
    const file = this.pidFile(name)
    if (!fs.existsSync(file)) return null
    const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
    return isNaN(pid) || pid <= 0 ? null : pid
  }

  private removePid(name: string): void {
    try { fs.unlinkSync(this.pidFile(name)) } catch { /* ignore */ }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Spawn a process, write its PID, wire up restart on crash.
   * Returns the PID of the newly spawned process.
   */
  startProcess(name: string, command: string, args: string[], opts: StartOptions = {}): number {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
    const logPath = this.logFile(name)
    const outFd = fs.openSync(logPath, 'a')

    const proc = spawn(command, args, {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      stdio: ['ignore', outFd, outFd],
      detached: false,
    })

    const managed: ManagedProcess = {
      name,
      command,
      args,
      opts,
      proc,
      restartTimestamps: [],
      stopped: false,
    }

    proc.on('exit', (code, signal) => {
      const msg = `${new Date().toISOString()} [EXIT] code=${code ?? 'null'} signal=${signal ?? 'none'}\n`
      try { fs.appendFileSync(logPath, msg) } catch { /* ignore */ }
      if (!managed.stopped) {
        this.handleCrash(managed)
      } else {
        this.removePid(name)
      }
    })

    this.processes.set(name, managed)
    this.writePid(name, proc.pid!)
    return proc.pid!
  }

  /**
   * Gracefully stop a named process: SIGTERM → 5s → SIGKILL → remove PID file.
   * Returns true if a running process was found and signalled.
   */
  stopProcess(name: string): boolean {
    const managed = this.processes.get(name)
    if (managed) managed.stopped = true

    const pid = this.readPid(name)
    if (!pid) {
      this.processes.delete(name)
      return false
    }

    try {
      process.kill(pid, 'SIGTERM')
      setTimeout(() => {
        try {
          process.kill(pid, 0) // still alive?
          process.kill(pid, 'SIGKILL')
        } catch { /* already dead */ }
        this.removePid(name)
      }, SIGTERM_TIMEOUT_MS).unref()

      this.processes.delete(name)
      return true
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        // Process already gone
        this.removePid(name)
        this.processes.delete(name)
        return false
      }
      throw err
    }
  }

  /** Check whether the process with this name is alive. */
  isRunning(name: string): boolean {
    const pid = this.readPid(name)
    if (!pid) return false
    try {
      process.kill(pid, 0) // signal 0 = existence check
      return true
    } catch {
      return false
    }
  }

  /** List all named processes found in the pids directory. */
  getProcesses(): ProcessInfo[] {
    if (!fs.existsSync(PIDS_DIR)) return []
    return fs.readdirSync(PIDS_DIR)
      .filter(f => f.endsWith('.pid'))
      .map(f => {
        const name = f.replace('.pid', '')
        const pid = this.readPid(name)
        return {
          name,
          pid,
          running: pid ? this.isRunning(name) : false,
          logPath: this.logFile(name),
        }
      })
  }

  /**
   * Start the watchdog loop.
   * Checks all managed processes every 10s; restarts any that have died
   * (up to MAX_RESTARTS_PER_HOUR per process).
   */
  watchdog(): void {
    if (this.watchdogTimer) return // already running

    this.watchdogTimer = setInterval(() => {
      for (const [name, managed] of this.processes.entries()) {
        if (managed.stopped) continue
        if (managed.proc?.exitCode === null) continue // still running in-process
        if (!this.isRunning(name)) {
          const msg = `${new Date().toISOString()} [WATCHDOG] ${name} not running — triggering restart\n`
          try { fs.appendFileSync(this.logFile(name), msg) } catch { /* ignore */ }
          console.warn(chalk.yellow(`[watchdog] ${name} not running — restarting...`))
          this.handleCrash(managed)
        }
      }
    }, WATCHDOG_INTERVAL_MS)

    this.watchdogTimer.unref()
  }

  stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private handleCrash(managed: ManagedProcess): void {
    if (managed.stopped) return

    const now = Date.now()
    // Expire timestamps older than 1 hour
    managed.restartTimestamps = managed.restartTimestamps.filter(t => now - t < ONE_HOUR_MS)

    if (managed.restartTimestamps.length >= MAX_RESTARTS_PER_HOUR) {
      const msg =
        `[ProcessManager] ${managed.name} crashed ${managed.restartTimestamps.length + 1} times ` +
        `within an hour. Restart limit (${MAX_RESTARTS_PER_HOUR}/hr) exceeded — manual intervention required.`
      console.error(chalk.red.bold(msg))
      try { fs.appendFileSync(this.logFile(managed.name), `${new Date().toISOString()} [ALERT] ${msg}\n`) } catch { /* ignore */ }
      return
    }

    managed.restartTimestamps.push(now)
    const used = managed.restartTimestamps.length
    const remaining = MAX_RESTARTS_PER_HOUR - used
    console.log(chalk.yellow(
      `[ProcessManager] Restarting ${managed.name} in ${RESTART_DELAY_MS / 1000}s ` +
      `(${used}/${MAX_RESTARTS_PER_HOUR} this hour, ${remaining} remaining)`
    ))

    setTimeout(() => {
      if (managed.stopped) return
      const { name, command, args, opts, restartTimestamps } = managed
      const pid = this.startProcess(name, command, args, opts)
      // Preserve the crash history so the limit still applies
      const fresh = this.processes.get(name)!
      fresh.restartTimestamps = restartTimestamps
      console.log(chalk.green(`[ProcessManager] ${name} restarted (PID ${pid})`))
    }, RESTART_DELAY_MS)
  }
}

/** Singleton shared by start / stop / status commands */
export const processManager = new ProcessManager()
