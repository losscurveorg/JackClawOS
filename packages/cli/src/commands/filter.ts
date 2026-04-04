/**
 * jackclaw filter — AI message filter management
 *
 * jackclaw filter status                      — today's filter statistics
 * jackclaw filter blocked                     — blocked/flagged messages today
 * jackclaw filter whitelist add @handle       — add to whitelist
 * jackclaw filter whitelist remove @handle    — remove from whitelist
 * jackclaw filter blacklist add @handle       — add to blacklist
 * jackclaw filter blacklist remove @handle    — remove from blacklist
 * jackclaw filter keyword add <word> [--action flag|block]
 * jackclaw filter keyword remove <word>
 */

import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'

const FILTER_DIR  = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_FILE = path.join(FILTER_DIR, 'filter.json')
const LOG_FILE    = path.join(FILTER_DIR, 'filter-log.jsonl')

interface KeywordRule { word: string; action: 'flag' | 'block' }
interface FilterConfig {
  whitelist: string[]
  blacklist: string[]
  keywords: KeywordRule[]
}
interface LogEntry {
  ts: number; messageId: string; fromAgent: string
  action: 'flag' | 'block'; reason: string; contentPreview: string
}

function loadConfig(): FilterConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { whitelist: [], blacklist: [], keywords: [] }
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as FilterConfig
}

function saveConfig(cfg: FilterConfig): void {
  fs.mkdirSync(FILTER_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

function norm(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`
}

function todayPrefix(): string {
  return new Date().toISOString().split('T')[0]!
}

function readTodayLog(): LogEntry[] {
  if (!fs.existsSync(LOG_FILE)) return []
  const today = todayPrefix()
  return fs.readFileSync(LOG_FILE, 'utf8')
    .trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as LogEntry } catch { return null } })
    .filter((e): e is LogEntry => e !== null && new Date(e.ts).toISOString().startsWith(today))
}

export function registerFilter(program: Command): void {
  const filter = program
    .command('filter')
    .description('AI message filter — rules-based spam/abuse protection')

  // ── status ──────────────────────────────────────────────────────────────────

  filter
    .command('status')
    .description('Show today\'s filter statistics')
    .action(() => {
      const entries = readTodayLog()
      const blocked = entries.filter(e => e.action === 'block').length
      const flagged  = entries.filter(e => e.action === 'flag').length
      const cfg = loadConfig()

      console.log(chalk.bold('\n[filter] Today\'s statistics'))
      console.log(`  ${chalk.red('Blocked')}:    ${blocked}`)
      console.log(`  ${chalk.yellow('Flagged')}:    ${flagged}`)
      console.log(`  ${chalk.cyan('Whitelist')}: ${cfg.whitelist.length} handle(s)`)
      console.log(`  ${chalk.magenta('Blacklist')}: ${cfg.blacklist.length} handle(s)`)
      console.log(`  ${chalk.gray('Keywords')}:  ${cfg.keywords.length} rule(s)`)
      console.log(`  Config: ${CONFIG_FILE}`)
      console.log(`  Log:    ${LOG_FILE}\n`)
    })

  // ── blocked ─────────────────────────────────────────────────────────────────

  filter
    .command('blocked')
    .description('Show blocked/flagged messages today')
    .option('--all', 'Show all (including flagged)', false)
    .action((opts: { all: boolean }) => {
      const entries = readTodayLog()
        .filter(e => opts.all || e.action === 'block')
        .reverse()

      if (entries.length === 0) {
        console.log(chalk.gray('[filter] No intercepted messages today.'))
        return
      }

      console.log(chalk.bold(`\n[filter] Intercepted messages today (${entries.length}):`))
      for (const e of entries) {
        const time    = chalk.gray(new Date(e.ts).toLocaleString())
        const from    = chalk.cyan(e.fromAgent)
        const action  = e.action === 'block' ? chalk.red('[BLOCK]') : chalk.yellow('[FLAG] ')
        const reason  = chalk.gray(e.reason)
        const preview = e.contentPreview.length > 60 ? e.contentPreview.slice(0, 60) + '…' : e.contentPreview
        console.log(`${time} ${action} ${from} — ${preview}`)
        console.log(`         ${reason}`)
      }
      console.log()
    })

  // ── whitelist ────────────────────────────────────────────────────────────────

  const whitelist = filter
    .command('whitelist')
    .description('Manage the trusted-sender whitelist')

  whitelist
    .command('add <handle>')
    .description('Always allow messages from this handle')
    .action((handle: string) => {
      const cfg = loadConfig()
      const h = norm(handle)
      if (cfg.whitelist.includes(h)) {
        console.log(chalk.yellow(`[filter] ${h} is already whitelisted.`))
        return
      }
      cfg.whitelist.push(h)
      cfg.blacklist = cfg.blacklist.filter(x => x !== h)
      saveConfig(cfg)
      console.log(chalk.green(`[filter] Added ${h} to whitelist.`))
    })

  whitelist
    .command('remove <handle>')
    .description('Remove a handle from the whitelist')
    .action((handle: string) => {
      const cfg = loadConfig()
      const h = norm(handle)
      const before = cfg.whitelist.length
      cfg.whitelist = cfg.whitelist.filter(x => x !== h)
      if (cfg.whitelist.length === before) {
        console.log(chalk.yellow(`[filter] ${h} was not in the whitelist.`))
      } else {
        saveConfig(cfg)
        console.log(chalk.green(`[filter] Removed ${h} from whitelist.`))
      }
    })

  whitelist
    .command('list')
    .description('Show all whitelisted handles')
    .action(() => {
      const cfg = loadConfig()
      if (cfg.whitelist.length === 0) {
        console.log(chalk.gray('[filter] Whitelist is empty.'))
        return
      }
      console.log(chalk.bold('[filter] Whitelist:'))
      cfg.whitelist.forEach(h => console.log(`  ${chalk.cyan(h)}`))
    })

  // ── blacklist ────────────────────────────────────────────────────────────────

  const blacklist = filter
    .command('blacklist')
    .description('Manage the blocked-sender blacklist')

  blacklist
    .command('add <handle>')
    .description('Always block messages from this handle')
    .action((handle: string) => {
      const cfg = loadConfig()
      const h = norm(handle)
      if (cfg.blacklist.includes(h)) {
        console.log(chalk.yellow(`[filter] ${h} is already blacklisted.`))
        return
      }
      cfg.blacklist.push(h)
      cfg.whitelist = cfg.whitelist.filter(x => x !== h)
      saveConfig(cfg)
      console.log(chalk.green(`[filter] Added ${h} to blacklist.`))
    })

  blacklist
    .command('remove <handle>')
    .description('Remove a handle from the blacklist')
    .action((handle: string) => {
      const cfg = loadConfig()
      const h = norm(handle)
      const before = cfg.blacklist.length
      cfg.blacklist = cfg.blacklist.filter(x => x !== h)
      if (cfg.blacklist.length === before) {
        console.log(chalk.yellow(`[filter] ${h} was not in the blacklist.`))
      } else {
        saveConfig(cfg)
        console.log(chalk.green(`[filter] Removed ${h} from blacklist.`))
      }
    })

  blacklist
    .command('list')
    .description('Show all blacklisted handles')
    .action(() => {
      const cfg = loadConfig()
      if (cfg.blacklist.length === 0) {
        console.log(chalk.gray('[filter] Blacklist is empty.'))
        return
      }
      console.log(chalk.bold('[filter] Blacklist:'))
      cfg.blacklist.forEach(h => console.log(`  ${chalk.red(h)}`))
    })

  // ── keyword ──────────────────────────────────────────────────────────────────

  const keyword = filter
    .command('keyword')
    .description('Manage keyword filter rules')

  keyword
    .command('add <word>')
    .description('Add a keyword filter rule')
    .option('--action <action>', 'Action: flag or block', 'flag')
    .action((word: string, opts: { action: string }) => {
      const action = (opts.action === 'block' ? 'block' : 'flag') as 'flag' | 'block'
      const cfg = loadConfig()
      if (cfg.keywords.some(k => k.word === word)) {
        console.log(chalk.yellow(`[filter] Keyword "${word}" already exists.`))
        return
      }
      cfg.keywords.push({ word, action })
      saveConfig(cfg)
      console.log(chalk.green(`[filter] Added keyword "${word}" → ${action}.`))
    })

  keyword
    .command('remove <word>')
    .description('Remove a keyword filter rule')
    .action((word: string) => {
      const cfg = loadConfig()
      const before = cfg.keywords.length
      cfg.keywords = cfg.keywords.filter(k => k.word !== word)
      if (cfg.keywords.length === before) {
        console.log(chalk.yellow(`[filter] Keyword "${word}" not found.`))
      } else {
        saveConfig(cfg)
        console.log(chalk.green(`[filter] Removed keyword "${word}".`))
      }
    })

  keyword
    .command('list')
    .description('Show all keyword rules')
    .action(() => {
      const cfg = loadConfig()
      if (cfg.keywords.length === 0) {
        console.log(chalk.gray('[filter] No keyword rules configured.'))
        return
      }
      console.log(chalk.bold('[filter] Keyword rules:'))
      for (const k of cfg.keywords) {
        const action = k.action === 'block' ? chalk.red('block') : chalk.yellow('flag')
        console.log(`  "${chalk.cyan(k.word)}" → ${action}`)
      }
    })
}
