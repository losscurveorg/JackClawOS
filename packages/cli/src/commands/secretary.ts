/**
 * jackclaw secretary — AI 秘书命令
 *
 * jackclaw secretary status                  — 当前模式
 * jackclaw secretary mode <online|busy|away|dnd>  — 切换模式
 * jackclaw secretary summary                 — 未读摘要
 * jackclaw secretary auto-reply '<text>'     — 设置自定义自动回复
 */

import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Config paths (mirrors ai-secretary.ts, CLI reads directly) ───────────────

const SECRETARY_DIR  = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_PATH    = path.join(SECRETARY_DIR, 'secretary.json')
const PENDING_PATH   = path.join(SECRETARY_DIR, 'secretary-pending.json')
const STATS_PATH     = path.join(SECRETARY_DIR, 'secretary-stats.json')

type SecretaryMode = 'online' | 'busy' | 'away' | 'dnd'
type Priority = 'urgent' | 'normal' | 'low' | 'spam'

interface SecretaryConfig {
  mode: SecretaryMode
  trustedContacts: string[]
  blockedContacts: string[]
  customAutoReply?: string
  updatedAt: number
}

interface PendingMessage {
  msg: { id: string; from: string; content: string; ts: number }
  priority: Priority
  receivedAt: number
  autoReplied: boolean
}

interface DayStat {
  received: number
  urgent: number
  autoReplied: number
  senders: Record<string, number>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig(): SecretaryConfig {
  const defaults: SecretaryConfig = {
    mode: 'online',
    trustedContacts: [],
    blockedContacts: [],
    updatedAt: Date.now(),
  }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
    }
  } catch { /* ignore */ }
  return defaults
}

function saveConfig(cfg: SecretaryConfig): void {
  if (!fs.existsSync(SECRETARY_DIR)) {
    fs.mkdirSync(SECRETARY_DIR, { recursive: true, mode: 0o700 })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

function loadPending(): PendingMessage[] {
  try {
    if (fs.existsSync(PENDING_PATH)) {
      return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'))
    }
  } catch { /* ignore */ }
  return []
}

function loadStats(): Record<string, DayStat> {
  try {
    if (fs.existsSync(STATS_PATH)) {
      return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

const MODE_LABELS: Record<SecretaryMode, string> = {
  online: chalk.green('● online') + '  直接通知主人',
  busy:   chalk.yellow('● busy') + '   紧急消息通知，其余暂存',
  away:   chalk.blue('● away') + '   AI 自动回复 + 暂存',
  dnd:    chalk.red('● dnd') + '    全部暂存，勿扰模式',
}

const PRIORITY_COLOR: Record<Priority, (s: string) => string> = {
  urgent: s => chalk.red(s),
  normal: s => chalk.cyan(s),
  low:    s => chalk.gray(s),
  spam:   s => chalk.dim(s),
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerSecretary(program: Command): void {
  const cmd = program
    .command('secretary')
    .description('AI secretary — auto-reply, priority, and unread summary')

  // ── status ──────────────────────────────────────────────────────────────────
  cmd
    .command('status')
    .description('Show current secretary mode and stats')
    .action(() => {
      const cfg   = loadConfig()
      const stats = loadStats()
      const today = todayKey()
      const stat  = stats[today] ?? { received: 0, urgent: 0, autoReplied: 0, senders: {} }
      const pending = loadPending()
      const unread  = pending.filter(p => !p.autoReplied).length

      console.log('')
      console.log(chalk.bold('AI Secretary'))
      console.log(chalk.gray('─'.repeat(40)))
      console.log(`  ${chalk.bold('Mode')}           ${MODE_LABELS[cfg.mode]}`)
      console.log(`  ${chalk.bold('Today received')} ${stat.received}`)
      console.log(`  ${chalk.bold('Urgent')}         ${chalk.red(String(stat.urgent))}`)
      console.log(`  ${chalk.bold('Auto-replied')}   ${stat.autoReplied}`)
      console.log(`  ${chalk.bold('Pending unread')} ${unread}`)
      if (cfg.customAutoReply) {
        console.log(`  ${chalk.bold('Auto-reply')}     "${chalk.italic(cfg.customAutoReply)}"`)
      }
      if (cfg.trustedContacts.length > 0) {
        console.log(`  ${chalk.bold('Trusted')}        ${cfg.trustedContacts.join(', ')}`)
      }
      console.log('')
    })

  // ── mode ─────────────────────────────────────────────────────────────────────
  cmd
    .command('mode <mode>')
    .description('Set secretary mode: online | busy | away | dnd')
    .action((mode: string) => {
      const valid: SecretaryMode[] = ['online', 'busy', 'away', 'dnd']
      if (!valid.includes(mode as SecretaryMode)) {
        console.error(chalk.red(`✗ Invalid mode "${mode}". Choose: ${valid.join(' | ')}`))
        process.exit(1)
      }
      const cfg = loadConfig()
      cfg.mode = mode as SecretaryMode
      cfg.updatedAt = Date.now()
      saveConfig(cfg)
      console.log(chalk.green(`✓ Secretary mode set to: ${mode}`))
      console.log(`  ${MODE_LABELS[mode as SecretaryMode]}`)
    })

  // ── summary ──────────────────────────────────────────────────────────────────
  cmd
    .command('summary')
    .description('Show unread message summary')
    .option('--all', 'Show all pending including auto-replied')
    .action((opts: { all?: boolean }) => {
      const pending = loadPending()
      const shown   = opts.all ? pending : pending.filter(p => !p.autoReplied)

      console.log('')
      console.log(chalk.bold('Unread Messages'))
      console.log(chalk.gray('─'.repeat(40)))

      if (shown.length === 0) {
        console.log(chalk.gray('  暂无未读消息。'))
        console.log('')
        return
      }

      // Group by priority
      const byPriority: Record<Priority, PendingMessage[]> = {
        urgent: [], normal: [], low: [], spam: [],
      }
      for (const p of shown) {
        byPriority[p.priority].push(p)
      }

      for (const priority of ['urgent', 'normal', 'low', 'spam'] as Priority[]) {
        const group = byPriority[priority]
        if (group.length === 0) continue

        const label = PRIORITY_COLOR[priority](`[${priority.toUpperCase()}]`)
        console.log(`\n  ${label} — ${group.length} 条`)

        for (const item of group.slice(0, 10)) {
          const time = new Date(item.receivedAt).toLocaleTimeString()
          const auto = item.autoReplied ? chalk.dim(' (已自动回复)') : ''
          const preview = item.msg.content.slice(0, 60) + (item.msg.content.length > 60 ? '…' : '')
          console.log(`    ${chalk.gray(time)}  ${chalk.bold(item.msg.from)}${auto}`)
          console.log(`    ${chalk.white(preview)}`)
        }
        if (group.length > 10) {
          console.log(chalk.gray(`    ... 还有 ${group.length - 10} 条`))
        }
      }

      // Today's stats
      const stats = loadStats()
      const stat  = stats[todayKey()] ?? { received: 0, urgent: 0, autoReplied: 0, senders: {} }
      console.log('')
      console.log(chalk.gray('─'.repeat(40)))
      console.log(chalk.gray(`  今日共收 ${stat.received} 条，紧急 ${stat.urgent}，自动回复 ${stat.autoReplied}`))
      console.log('')
    })

  // ── auto-reply ───────────────────────────────────────────────────────────────
  cmd
    .command('auto-reply [text]')
    .description('Set or clear custom auto-reply message')
    .action((text?: string) => {
      const cfg = loadConfig()
      if (!text) {
        // Clear
        delete cfg.customAutoReply
        cfg.updatedAt = Date.now()
        saveConfig(cfg)
        console.log(chalk.yellow('✓ Custom auto-reply cleared. AI will generate replies dynamically.'))
      } else {
        cfg.customAutoReply = text
        cfg.updatedAt = Date.now()
        saveConfig(cfg)
        console.log(chalk.green(`✓ Auto-reply set: "${text}"`))
      }
    })
}
