/**
 * jackclaw moltbook — Moltbook AI Agent social network CLI
 *
 * jackclaw moltbook connect <api_key>              — connect Moltbook account
 * jackclaw moltbook register <name> <description>  — register new Agent
 * jackclaw moltbook status                         — view status/karma
 * jackclaw moltbook post <submolt> <title> [content] — create a post
 * jackclaw moltbook feed [--sort hot|new|top]      — browse feed
 * jackclaw moltbook search <query>                 — search posts
 * jackclaw moltbook digest                         — today's digest
 */

import { Command } from 'commander'
import axios from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadConfig } from '../config-utils'

const MOLTBOOK_API  = 'https://www.moltbook.com/api/v1'
const CONFIG_DIR    = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_FILE   = path.join(CONFIG_DIR, 'moltbook.json')

interface MoltbookCLIConfig {
  apiKey: string
  agent?: { name: string; description: string; karma?: number }
}

function loadMoltbookConfig(): MoltbookCLIConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as MoltbookCLIConfig
    }
  } catch { /* ignore */ }
  return null
}

function saveMoltbookConfig(cfg: MoltbookCLIConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

function requireApiKey(): string {
  const cfg = loadMoltbookConfig()
  if (!cfg?.apiKey) {
    console.error(chalk.red('[moltbook] Not connected. Run: jackclaw moltbook connect <api_key>'))
    process.exit(1)
  }
  return cfg.apiKey
}

function getHub(opts: { hub?: string }): string {
  const cfg = loadConfig()
  return (opts.hub ?? cfg?.hubUrl ?? 'http://localhost:3100').replace(/\/$/, '')
}

function moltbookHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

function formatScore(score: number): string {
  if (score > 100) return chalk.green(`${score}↑`)
  if (score > 10)  return chalk.yellow(`${score}↑`)
  return chalk.gray(`${score}↑`)
}

export function registerMoltbook(program: Command): void {
  const mb = program
    .command('moltbook')
    .description('Moltbook AI Agent social network integration')

  // ── connect ────────────────────────────────────────────────────────────────

  mb
    .command('connect <api_key>')
    .description('Connect a Moltbook account by API key')
    .option('--hub <url>', 'Hub URL (also syncs key to Hub)')
    .action(async (apiKey: string, opts: { hub?: string }) => {
      // Validate API key works
      try {
        const res = await axios.get(`${MOLTBOOK_API}/agents/me`, {
          headers: moltbookHeaders(apiKey),
        })
        const agent = res.data as { name: string; karma: number; postCount: number }
        saveMoltbookConfig({ apiKey, agent: { name: agent.name, description: '' } })
        console.log(chalk.green(`[moltbook] Connected ✓ — agent="${agent.name}" karma=${agent.karma} posts=${agent.postCount}`))

        // Optionally sync to Hub
        const cfg = loadConfig()
        const hubUrl = getHub(opts)
        if (hubUrl && cfg) {
          try {
            await axios.post(`${hubUrl}/api/moltbook/connect`, { apiKey }, {
              headers: { 'Content-Type': 'application/json' },
            })
            console.log(chalk.gray(`[moltbook] API key synced to Hub at ${hubUrl}`))
          } catch { /* non-fatal */ }
        }
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Connection failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── register ───────────────────────────────────────────────────────────────

  mb
    .command('register <name> <description>')
    .description('Register a new Agent on Moltbook (creates new account)')
    .action(async (name: string, description: string) => {
      try {
        const res = await axios.post(`${MOLTBOOK_API}/agents/register`, { name, description }, {
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        })
        const { api_key, agent } = res.data as { api_key: string; agent: { name: string; karma: number } }
        saveMoltbookConfig({ apiKey: api_key, agent: { name, description } })
        console.log(chalk.green(`[moltbook] Registered ✓ — agent="${agent.name}" karma=${agent.karma}`))
        console.log(chalk.gray(`[moltbook] API key saved to ${CONFIG_FILE}`))
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Registration failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── status ─────────────────────────────────────────────────────────────────

  mb
    .command('status')
    .description('View Moltbook connection status and karma')
    .option('--hub <url>', 'Hub URL')
    .action(async (_opts: { hub?: string }) => {
      const apiKey = requireApiKey()
      try {
        const res = await axios.get(`${MOLTBOOK_API}/agents/me`, {
          headers: moltbookHeaders(apiKey),
        })
        const me = res.data as { name: string; karma: number; postCount: number; commentCount: number }
        console.log(chalk.bold('\n[moltbook] Agent Status'))
        console.log(`  Name:     ${chalk.cyan(me.name)}`)
        console.log(`  Karma:    ${chalk.green(String(me.karma))}`)
        console.log(`  Posts:    ${me.postCount}`)
        console.log(`  Comments: ${me.commentCount}`)
        console.log()
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── post ───────────────────────────────────────────────────────────────────

  mb
    .command('post <submolt> <title> [content]')
    .description('Create a post on Moltbook')
    .option('--url <url>', 'Link post URL')
    .action(async (submolt: string, title: string, content: string | undefined, opts: { url?: string }) => {
      const apiKey = requireApiKey()
      const body: Record<string, string> = {
        submolt,
        title,
        content: content ?? title,
      }
      if (opts.url) body['url'] = opts.url

      try {
        const res = await axios.post(`${MOLTBOOK_API}/posts`, body, {
          headers: moltbookHeaders(apiKey),
        })
        const post = res.data as { id: string; title: string; submolt: string }
        console.log(chalk.green(`[moltbook] Posted ✓ id=${post.id}`))
        console.log(`  Title:   ${chalk.cyan(post.title)}`)
        console.log(`  Submolt: m/${post.submolt}`)
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Post failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── feed ───────────────────────────────────────────────────────────────────

  mb
    .command('feed')
    .description('Browse Moltbook feed')
    .option('--sort <sort>', 'Sort: hot|new|top|rising', 'hot')
    .option('--limit <n>', 'Number of posts', '20')
    .action(async (opts: { sort: string; limit: string }) => {
      const apiKey = requireApiKey()
      try {
        const res = await axios.get(`${MOLTBOOK_API}/feed`, {
          headers: moltbookHeaders(apiKey),
          params: { sort: opts.sort, limit: opts.limit },
        })
        const posts = (res.data.posts ?? []) as Array<{
          id: string; title: string; submolt: string; author: string; score: number; commentCount: number
        }>
        if (posts.length === 0) {
          console.log(chalk.gray('[moltbook] No posts in feed.'))
          return
        }
        console.log(chalk.bold(`\n[moltbook] Feed — ${opts.sort} (${posts.length} posts)\n`))
        for (const p of posts) {
          const score    = formatScore(p.score)
          const comments = chalk.gray(`${p.commentCount}💬`)
          const sub      = chalk.cyan(`m/${p.submolt}`)
          const author   = chalk.gray(`by ${p.author}`)
          const id       = chalk.gray(` [${p.id.slice(0, 8)}]`)
          console.log(`  ${score} ${comments} ${sub} — ${p.title}${id}`)
          console.log(`         ${author}`)
        }
        console.log()
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Feed failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── search ─────────────────────────────────────────────────────────────────

  mb
    .command('search <query>')
    .description('Search Moltbook posts')
    .action(async (query: string) => {
      const apiKey = requireApiKey()
      try {
        const res = await axios.get(`${MOLTBOOK_API}/search`, {
          headers: moltbookHeaders(apiKey),
          params: { q: query },
        })
        const posts = (res.data.posts ?? []) as Array<{
          id: string; title: string; submolt: string; author: string; score: number
        }>
        if (posts.length === 0) {
          console.log(chalk.gray(`[moltbook] No results for "${query}"`))
          return
        }
        console.log(chalk.bold(`\n[moltbook] Search: "${query}" (${posts.length} results)\n`))
        for (const p of posts) {
          const score  = formatScore(p.score)
          const sub    = chalk.cyan(`m/${p.submolt}`)
          const author = chalk.gray(`by ${p.author}`)
          const id     = chalk.gray(` [${p.id.slice(0, 8)}]`)
          console.log(`  ${score} ${sub} — ${p.title}${id}`)
          console.log(`         ${author}`)
        }
        console.log()
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Search failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── digest ─────────────────────────────────────────────────────────────────

  mb
    .command('digest')
    .description('View today\'s Moltbook digest')
    .option('--hub <url>', 'Fetch via Hub (uses Hub\'s cached digest)')
    .action(async (opts: { hub?: string }) => {
      const apiKey = requireApiKey()
      const hubUrl = getHub(opts)

      // Try Hub digest endpoint first
      if (hubUrl) {
        try {
          const res = await axios.get(`${hubUrl}/api/moltbook/digest`)
          console.log(chalk.bold('\n' + (res.data.digest as string) + '\n'))
          return
        } catch { /* fall through to direct API */ }
      }

      // Direct API fallback
      try {
        const res = await axios.get(`${MOLTBOOK_API}/posts`, {
          headers: moltbookHeaders(apiKey),
          params: { sort: 'hot', limit: '10' },
        })
        const posts = (res.data.posts ?? []) as Array<{
          title: string; submolt: string; score: number; author: string
        }>
        console.log(chalk.bold(`\n[moltbook] Digest — ${new Date().toLocaleDateString()}\n`))
        for (const p of posts) {
          console.log(`  ${formatScore(p.score)} m/${chalk.cyan(p.submolt)} — ${p.title}`)
        }
        console.log()
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err)
        console.error(chalk.red(`[moltbook] Digest failed: ${msg}`))
        process.exit(1)
      }
    })
}
