/**
 * CLI command: jackclaw model
 *
 * Subcommands:
 *   list   — list all available models (local + cloud)
 *   set    — set default model/provider
 *   test   — test if a model is reachable
 *   scan   — scan for local models (Ollama)
 */
import { Command } from 'commander'
import chalk from 'chalk'
import http from 'http'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { loadLLMConfig, saveLLMConfig, setLLMConfigValue } from '@jackclaw/llm-gateway'
import { OllamaProvider } from '@jackclaw/llm-gateway'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ollamaBaseUrl(): string {
  const cfg = loadLLMConfig()
  return cfg.providers.ollama?.baseUrl ?? 'http://localhost:11434'
}

async function pingOllama(baseUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const url = new URL(baseUrl)
      const req = http.get({ hostname: url.hostname, port: url.port || 11434, path: '/', timeout: 3000 }, res => {
        resolve(res.statusCode !== undefined && res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    } catch {
      resolve(false)
    }
  })
}

/** Fetch model list from Ollama /api/tags */
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl + '/api/tags')
      const req = http.get({ hostname: url.hostname, port: Number(url.port) || 11434, path: '/api/tags', timeout: 5000 }, res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(d)
            resolve((json.models ?? []).map((m: any) => m.name as string))
          } catch {
            resolve([])
          }
        })
      })
      req.on('error', () => resolve([]))
      req.on('timeout', () => { req.destroy(); resolve([]) })
    } catch {
      resolve([])
    }
  })
}

/** Check ~/.cache/huggingface/hub for MLX/GGUF model dirs */
function scanLocalMLXModels(): string[] {
  const hfCache = path.join(os.homedir(), '.cache', 'huggingface', 'hub')
  try {
    if (!fs.existsSync(hfCache)) return []
    return fs.readdirSync(hfCache).filter(d => {
      const lower = d.toLowerCase()
      return lower.includes('qwen') || lower.includes('llama') || lower.includes('mistral') ||
             lower.includes('phi') || lower.includes('gemma') || lower.includes('mlx')
    })
  } catch {
    return []
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerModelCommand(program: Command): void {
  const model = program
    .command('model')
    .description('Manage LLM models and providers')

  // ── jackclaw model list ───────────────────────────────────────────
  model
    .command('list')
    .description('List all available models (local + cloud)')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadLLMConfig()
      const ollamaUrl = config.providers.ollama?.baseUrl ?? 'http://localhost:11434'

      const ollamaRunning = await pingOllama(ollamaUrl)
      const ollamaModels = ollamaRunning ? await fetchOllamaModels(ollamaUrl) : []
      const mlxModels = scanLocalMLXModels()

      interface ModelEntry { model: string; provider: string; type: string; status: string }
      const entries: ModelEntry[] = []

      // Local: Ollama
      for (const m of ollamaModels) {
        entries.push({ model: m, provider: 'ollama', type: 'local', status: 'available' })
      }
      if (!ollamaRunning) {
        entries.push({ model: '(ollama not running)', provider: 'ollama', type: 'local', status: 'offline' })
      }

      // Local: MLX / HuggingFace
      for (const m of mlxModels) {
        entries.push({ model: m, provider: 'mlx', type: 'local', status: 'installed' })
      }

      // Cloud: configured providers
      const cloudProviders = Object.entries(config.providers).filter(
        ([name]) => name !== 'ollama' && name !== 'mlx',
      )
      for (const [name, pc] of cloudProviders) {
        if (!pc?.apiKey) continue
        entries.push({ model: pc.defaultModel ?? name, provider: name, type: 'cloud', status: 'configured' })
      }

      if (opts.json) {
        console.log(JSON.stringify({ default: config.defaultProvider, defaultModel: config.defaultModel, models: entries }, null, 2))
        return
      }

      console.log('')
      console.log(chalk.bold('Available Models'))
      console.log(chalk.gray(`Default: ${chalk.cyan(config.defaultModel ? `${config.defaultProvider}/${config.defaultModel}` : config.defaultProvider)}`))
      console.log(chalk.gray('─'.repeat(60)))

      // Group by type
      const local = entries.filter(e => e.type === 'local')
      const cloud = entries.filter(e => e.type === 'cloud')

      if (local.length) {
        console.log(chalk.bold.yellow('  Local'))
        for (const e of local) {
          const badge = e.status === 'available' ? chalk.green('●') : chalk.gray('○')
          console.log(`    ${badge} ${chalk.white(e.model)} ${chalk.gray(`(${e.provider})`)}`)
        }
      }
      if (cloud.length) {
        console.log(chalk.bold.blue('  Cloud'))
        for (const e of cloud) {
          console.log(`    ${chalk.cyan('●')} ${chalk.white(e.model)} ${chalk.gray(`(${e.provider})`)}`)
        }
      }
      if (!entries.length) {
        console.log(chalk.gray('  No models found. Run: jackclaw model scan'))
      }
      console.log('')
    })

  // ── jackclaw model set <model> ────────────────────────────────────
  model
    .command('set <model>')
    .description('Set default model (format: provider/model or just model)')
    .action((modelStr: string) => {
      try {
        setLLMConfigValue('llm.default', modelStr)
        const cfg = loadLLMConfig()
        const display = cfg.defaultModel
          ? `${cfg.defaultProvider}/${cfg.defaultModel}`
          : cfg.defaultProvider
        console.log(chalk.green(`✓ Default model set to: ${chalk.bold(display)}`))
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`))
        process.exit(1)
      }
    })

  // ── jackclaw model test <model> ───────────────────────────────────
  model
    .command('test <model>')
    .description('Test if a model is available')
    .action(async (modelStr: string) => {
      // Parse provider prefix
      let providerName = 'ollama'
      let modelName = modelStr

      if (modelStr.includes('/')) {
        const parts = modelStr.split('/')
        providerName = parts[0]
        modelName = parts.slice(1).join('/')
      } else if (modelStr.startsWith('claude')) {
        providerName = 'anthropic'
      } else if (modelStr.startsWith('gpt') || modelStr.startsWith('o1') || modelStr.startsWith('o3')) {
        providerName = 'openai'
      } else if (modelStr.startsWith('gemini')) {
        providerName = 'google'
      } else if (modelStr.startsWith('deepseek')) {
        providerName = 'deepseek'
      } else if (modelStr.startsWith('qwen')) {
        providerName = 'qwen'
      }

      process.stdout.write(chalk.gray(`Testing ${chalk.bold(modelStr)} via ${providerName}...`))

      const config = loadLLMConfig()
      const pc = config.providers[providerName]

      if (providerName === 'ollama') {
        const url = pc?.baseUrl ?? 'http://localhost:11434'
        const running = await pingOllama(url)
        if (!running) {
          console.log(chalk.red(' ✗ Ollama not running'))
          process.exit(1)
        }
        const models = await fetchOllamaModels(url)
        const found = models.some(m => m === modelName || m.startsWith(modelName))
        if (found) {
          console.log(chalk.green(' ✓ available'))
        } else {
          console.log(chalk.yellow(` ⚠ Ollama running but model "${modelName}" not found`))
          console.log(chalk.gray(`  Run: ollama pull ${modelName}`))
          process.exit(1)
        }
      } else {
        if (!pc?.apiKey) {
          console.log(chalk.red(` ✗ ${providerName} API key not configured`))
          console.log(chalk.gray(`  Run: jackclaw model set-key ${providerName} <api-key>`))
          process.exit(1)
        }
        console.log(chalk.green(' ✓ API key configured'))
      }
    })

  // ── jackclaw model scan ───────────────────────────────────────────
  model
    .command('scan')
    .description('Scan for locally available models (Ollama + HuggingFace MLX)')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadLLMConfig()
      const ollamaUrl = config.providers.ollama?.baseUrl ?? 'http://localhost:11434'

      console.log(chalk.gray('Scanning local models...'))

      const ollamaRunning = await pingOllama(ollamaUrl)
      const ollamaModels = ollamaRunning ? await fetchOllamaModels(ollamaUrl) : []
      const mlxModels = scanLocalMLXModels()

      if (opts.json) {
        console.log(JSON.stringify({
          ollama: { running: ollamaRunning, url: ollamaUrl, models: ollamaModels },
          mlx: { models: mlxModels },
        }, null, 2))
        return
      }

      console.log('')
      console.log(chalk.bold('Local Model Scan Results'))
      console.log(chalk.gray('─'.repeat(50)))

      // Ollama
      const ollamaStatus = ollamaRunning ? chalk.green('● running') : chalk.red('○ not running')
      console.log(`  Ollama (${ollamaUrl})  ${ollamaStatus}`)
      if (ollamaModels.length) {
        for (const m of ollamaModels) {
          console.log(`    ${chalk.green('✓')} ${m}`)
        }
      } else if (ollamaRunning) {
        console.log(chalk.gray(`    No models installed. Run: ollama pull qwen2.5:7b`))
      } else {
        console.log(chalk.gray(`    Install Ollama: https://ollama.com`))
      }

      // MLX / HuggingFace
      console.log('')
      console.log(`  HuggingFace cache (~/.cache/huggingface/hub)`)
      if (mlxModels.length) {
        for (const m of mlxModels) {
          console.log(`    ${chalk.cyan('✓')} ${m}`)
        }
      } else {
        console.log(chalk.gray('    No models found'))
      }

      if (ollamaModels.length || mlxModels.length) {
        const suggest = ollamaModels[0] ?? mlxModels[0]
        console.log('')
        console.log(chalk.gray(`  Tip: set default with: jackclaw model set ollama/${suggest ?? 'qwen2.5:7b'}`))
      }
      console.log('')
    })

  // ── jackclaw model set-key <provider> <apiKey> ────────────────────
  model
    .command('set-key <provider> <apiKey>')
    .description('Configure an API key for a cloud provider')
    .action((provider: string, apiKey: string) => {
      try {
        setLLMConfigValue(`providers.${provider}.apiKey`, apiKey)
        console.log(chalk.green(`✓ API key saved for ${chalk.bold(provider)}`))
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`))
        process.exit(1)
      }
    })
}
