/**
 * JackClaw Node↔Hub Integration Test
 *
 * Steps:
 *  1. Spawn Hub (port 13100)
 *  2. Spawn Node (port 13200, pointing to Hub)
 *  3. Wait for both health checks
 *  4. Register a CEO test node → obtain JWT
 *  5. GET /api/nodes — verify node appears
 *  6. POST /api/chat/send — send a message to offline node
 *  7. GET /api/chat/inbox — verify offline queue
 *  8. Print "✅ Integration test passed"
 *
 * Exits with code 1 after 30s if any step fails.
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { generateKeyPairSync } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

const HUB_PORT = 13100
const NODE_PORT = 13200
const HUB_URL = `http://localhost:${HUB_PORT}`
const NODE_URL = `http://localhost:${NODE_PORT}`
const TIMEOUT_MS = 30_000
const ROOT_DIR = path.resolve(__dirname, '..')

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers })
  const body = await res.json() as unknown
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function httpPost(url: string, data: object, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })
  const body = await res.json() as unknown
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function waitReady(url: string, label: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await httpGet(`${url}/health`)
      console.log(`  ✓ ${label} ready`)
      return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error(`${label} did not become ready within ${TIMEOUT_MS / 1000}s`)
}

async function main(): Promise<void> {
  const procs: ChildProcess[] = []
  const tmpDirs: string[] = []

  const hardTimer = setTimeout(() => {
    console.error('❌ Integration test timed out after 30s')
    cleanup()
    process.exit(1)
  }, TIMEOUT_MS)

  function cleanup(): void {
    clearTimeout(hardTimer)
    for (const p of procs) {
      try { p.kill('SIGTERM') } catch { /* ignore */ }
    }
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  try {
    const hubDist = path.join(ROOT_DIR, 'packages/hub/dist/index.js')
    const nodeDist = path.join(ROOT_DIR, 'packages/node/dist/src/index.js')

    if (!fs.existsSync(hubDist) || !fs.existsSync(nodeDist)) {
      console.log('Building packages...')
      execSync('npm run build --workspace=packages/hub --workspace=packages/node', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
    }

    // Step 1: Start Hub
    console.log(`\n1. Starting Hub on port ${HUB_PORT}`)
    const hubProc = spawn('node', [hubDist], {
      env: { ...process.env, HUB_PORT: String(HUB_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    procs.push(hubProc)
    hubProc.stdout?.on('data', (d: Buffer) => process.stdout.write(`   [hub] ${d}`))
    hubProc.stderr?.on('data', (d: Buffer) => process.stderr.write(`   [hub:err] ${d}`))

    // Step 2: Start Node with isolated HOME
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-test-'))
    tmpDirs.push(tmpHome)
    const jackDir = path.join(tmpHome, '.jackclaw')
    fs.mkdirSync(jackDir, { recursive: true })

    fs.writeFileSync(
      path.join(jackDir, 'config.json'),
      JSON.stringify({
        hubUrl: HUB_URL,
        port: NODE_PORT,
        reportCron: '0 8 * * *',
        workspaceDir: path.join(tmpHome, '.openclaw', 'workspace'),
        visibility: { shareMemory: false, shareTasks: false, redactPatterns: [] },
        ai: {
          baseUrl: 'http://localhost:1',
          authToken: 'test-dummy',
          model: 'claude-sonnet-4-6',
          maxMemoryEntries: 5,
          cacheProbeInterval: 86_400_000,
        },
      }, null, 2),
    )

    console.log(`2. Starting Node on port ${NODE_PORT}`)
    const nodeProc = spawn('node', [nodeDist], {
      env: { ...process.env, HOME: tmpHome, ANTHROPIC_AUTH_TOKEN: 'test-dummy' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    procs.push(nodeProc)
    nodeProc.stdout?.on('data', (d: Buffer) => process.stdout.write(`   [node] ${d}`))
    nodeProc.stderr?.on('data', (d: Buffer) => process.stderr.write(`   [node:err] ${d}`))

    // Step 3: Wait for health checks
    console.log('\n3. Waiting for services to become ready...')
    await Promise.all([
      waitReady(HUB_URL, 'Hub'),
      waitReady(NODE_URL, 'Node'),
    ])

    // Step 4: Register CEO node
    console.log('\n4. Registering test CEO node...')
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    })

    const regResult = await httpPost(`${HUB_URL}/api/register`, {
      nodeId: 'test-ceo-node',
      name: 'Integration Test CEO',
      role: 'ceo',
      publicKey,
    }) as { success: boolean; token: string }

    if (!regResult.success || !regResult.token) {
      throw new Error(`Registration failed: ${JSON.stringify(regResult)}`)
    }
    const authHeader = { Authorization: `Bearer ${regResult.token}` }
    console.log('  ✓ CEO node registered, JWT obtained')

    // Step 5: Verify node in GET /api/nodes
    console.log('\n5. Verifying node list...')
    const nodesResult = await httpGet(`${HUB_URL}/api/nodes`, authHeader) as {
      success: boolean
      total: number
      nodes: Array<{ nodeId: string }>
    }

    if (!nodesResult.success) throw new Error(`Nodes list failed: ${JSON.stringify(nodesResult)}`)
    if (!nodesResult.nodes.find(n => n.nodeId === 'test-ceo-node')) {
      throw new Error('test-ceo-node not found in node list')
    }
    console.log(`  ✓ Node list OK — ${nodesResult.total} node(s)`)

    // Step 6: Send ClawChat message
    console.log('\n6. Testing ClawChat send...')
    const msgId = `inttest-${Date.now()}`
    const sendResult = await httpPost(
      `${HUB_URL}/api/chat/send`,
      { id: msgId, from: 'test-ceo-node', to: 'test-offline-node', content: 'Hello from integration test' },
      authHeader,
    ) as { status: string; queued: string[] }

    if (sendResult.status !== 'ok') throw new Error(`Chat send failed: ${JSON.stringify(sendResult)}`)
    if (!sendResult.queued.includes('test-offline-node')) {
      throw new Error('Message not queued for offline node')
    }
    console.log(`  ✓ Message ${msgId} queued for offline delivery`)

    // Step 7: Check offline inbox
    console.log('\n7. Checking offline inbox...')
    const inboxResult = await httpGet(
      `${HUB_URL}/api/chat/inbox?nodeId=test-offline-node`,
      authHeader,
    ) as { messages: Array<{ id: string }>; count: number }

    if (!Array.isArray(inboxResult.messages)) {
      throw new Error(`Inbox response invalid: ${JSON.stringify(inboxResult)}`)
    }
    if (!inboxResult.messages.find(m => m.id === msgId)) {
      throw new Error(`Message ${msgId} not found in inbox`)
    }
    console.log(`  ✓ Inbox OK — ${inboxResult.count} message(s)`)

    console.log('\n✅ Integration test passed\n')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n❌ Integration test FAILED: ${msg}\n`)
    cleanup()
    process.exit(1)
  }

  cleanup()
  process.exit(0)
}

main()
