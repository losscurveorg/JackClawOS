#!/usr/bin/env node
/**
 * ClawChat Reconnect E2E Test (T20)
 *
 * 验证 WebSocket 断线重连后消息依然可以正常收发：
 *   1. 启动 Hub (port 3197)
 *   2. 注册用户，获取 token + agentNodeId
 *   3. 连接 WebSocket
 *   4. REST 发消息 → 确认 WS 收到
 *   5. Kill Hub
 *   6. 等 2 秒
 *   7. 重启 Hub
 *   8. WebSocket 重连
 *   9. REST 再发消息 → 确认 WS 收到
 *  10. process.exit(0)
 */

import http from 'http'
import { spawn } from 'child_process'
import WebSocket from 'ws'

const HUB_PORT = 3197
const HUB_URL  = `http://localhost:${HUB_PORT}`
const JWT_SECRET = 'test-secret-reconnect'
const TIMEOUT_MS = 30_000

const TEST_HANDLE   = `reconnect${Date.now()}`
const TEST_PASSWORD = 'reconnect123'
const TEST_NAME     = 'Reconnect Tester'

let hubProcess = null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

function pass(msg) { console.log(`  ✅ ${msg}`) }

function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}`)
  killHub().finally(() => process.exit(1))
}

function waitFor(ms) { return new Promise(r => setTimeout(r, ms)) }

async function killHub() {
  if (!hubProcess) return
  hubProcess.kill('SIGTERM')
  await waitFor(500)
  if (!hubProcess.killed) hubProcess.kill('SIGKILL')
  hubProcess = null
}

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const u = new URL(url)
    const headers = { 'Content-Type': 'application/json' }
    if (data)  headers['Content-Length'] = Buffer.byteLength(data)
    if (token) headers['Authorization']  = `Bearer ${token}`

    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let buf = ''
        res.on('data', c => buf += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
          catch { resolve({ status: res.statusCode, body: buf }) }
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const post = (url, body, token) => request('POST', url, body, token)
const get  = (url, token)       => request('GET',  url, null, token)

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await get(`${HUB_URL}/health`)
      if (res.status === 200) return true
    } catch { /* not up yet */ }
    await waitFor(300)
  }
  return false
}

function spawnHub() {
  const proc = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HUB_PORT:   String(HUB_PORT),
      JWT_SECRET,
      NODE_ENV:   'test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', d => { const l = d.toString().trim(); if (l) log('hub', l) })
  proc.stderr.on('data', d => { const l = d.toString().trim(); if (l) log('hub:err', l) })
  proc.on('exit', code => log('hub', `Process exited (${code})`))
  return proc
}

/**
 * Open a WebSocket connection identified by nodeId.
 * Resolves when the connection is OPEN.
 */
function openWs(nodeId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${HUB_PORT}/chat/ws?nodeId=${encodeURIComponent(nodeId)}`)
    ws.once('open',  () => resolve(ws))
    ws.once('error', reject)
    ws.once('close', (code, reason) => reject(new Error(`WS closed before open: ${code} ${reason}`)))
  })
}

/**
 * Wait for a message event on ws whose data.id === messageId.
 * Resolves with the message. Times out after timeoutMs.
 */
function waitForMessage(ws, messageId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`Timed out waiting for message ${messageId}`))
    }, timeoutMs)

    function handler(raw) {
      try {
        const parsed = JSON.parse(raw.toString())
        if (parsed.event === 'message' && parsed.data?.id === messageId) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(parsed.data)
        }
      } catch { /* ignore parse errors */ }
    }

    ws.on('message', handler)
  })
}

// ─── Test steps ───────────────────────────────────────────────────────────────

async function step1_startHub() {
  log('step1', `Spawning Hub on port ${HUB_PORT}`)
  hubProcess = spawnHub()
  const ready = await waitForHealth()
  if (!ready) return fail('Hub did not start within 15s')
  pass('Hub started and healthy')
}

async function step2_register() {
  log('step2', `POST /api/auth/register  handle=@${TEST_HANDLE}`)
  const res = await post(`${HUB_URL}/api/auth/register`, {
    handle:      TEST_HANDLE,
    password:    TEST_PASSWORD,
    displayName: TEST_NAME,
  })
  if (res.status !== 201)        return fail(`register: expected 201, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (!res.body.token)           return fail('register: no token')
  if (!res.body.user?.agentNodeId) return fail('register: no agentNodeId')

  pass(`Registered @${TEST_HANDLE}, agentNodeId=${res.body.user.agentNodeId}`)
  return { token: res.body.token, nodeId: res.body.user.agentNodeId }
}

async function step3_connectWs(nodeId) {
  log('step3', `Connecting WebSocket as nodeId=${nodeId}`)
  const ws = await openWs(nodeId)
  pass('WebSocket connected')
  return ws
}

async function step4_sendAndReceive(ws, nodeId, label) {
  const msgId = `msg-${label}-${Date.now()}`
  log(`step:${label}`, `Sending message id=${msgId}`)

  // Listen for delivery before sending, to avoid a race
  const deliveryPromise = waitForMessage(ws, msgId, 5000)

  const res = await post(`${HUB_URL}/api/chat/send`, {
    id:      msgId,
    from:    nodeId,
    to:      nodeId,   // self-message — Hub will deliver back to same nodeId
    content: `Hello from ${label}`,
    type:    'system',
    ts:      Date.now(),
  })

  if (res.status !== 200) return fail(`/chat/send ${label}: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  log(`step:${label}`, `REST accepted (messageId=${res.body.messageId})`)

  const delivered = await deliveryPromise
  if (!delivered) return fail(`${label}: message not delivered over WebSocket`)

  pass(`[${label}] Message sent and received over WebSocket (id=${delivered.id})`)
}

async function step5_killHub() {
  log('step5', 'Killing Hub via SIGKILL')
  const pid = hubProcess.pid
  process.kill(pid, 'SIGKILL')
  await waitFor(200)   // give OS a moment to kill it
  pass(`Hub killed (pid=${pid})`)
  hubProcess = null
}

async function step6_wait() {
  log('step6', 'Waiting 2 seconds...')
  await waitFor(2000)
  pass('Waited 2s')
}

async function step7_restartHub() {
  log('step7', `Restarting Hub on port ${HUB_PORT}`)
  hubProcess = spawnHub()
  const ready = await waitForHealth(15_000)
  if (!ready) return fail('Hub did not restart within 15s')
  pass('Hub restarted and healthy')
}

async function step8_reconnectWs(nodeId) {
  log('step8', `Reconnecting WebSocket as nodeId=${nodeId}`)
  const ws = await openWs(nodeId)
  pass('WebSocket reconnected successfully')
  return ws
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 ClawChat Reconnect E2E Test (T20)')
  console.log('━'.repeat(50))
  console.log(`   handle:   @${TEST_HANDLE}`)
  console.log(`   port:     ${HUB_PORT}`)
  console.log('━'.repeat(50))

  const globalTimer = setTimeout(() => fail(`Global timeout (${TIMEOUT_MS / 1000}s)`), TIMEOUT_MS)
  let ws1 = null
  let ws2 = null

  try {
    await step1_startHub()

    const { nodeId } = await step2_register()

    ws1 = await step3_connectWs(nodeId)
    await step4_sendAndReceive(ws1, nodeId, 'before-kill')

    // Close client ws cleanly before kill (avoids noisy errors)
    ws1.terminate()
    ws1 = null

    await step5_killHub()
    await step6_wait()
    await step7_restartHub()

    ws2 = await step8_reconnectWs(nodeId)
    await step4_sendAndReceive(ws2, nodeId, 'after-reconnect')

    clearTimeout(globalTimer)
    console.log('\n' + '━'.repeat(50))
    console.log('🎉 ALL RECONNECT TESTS PASSED — 断线重连验证成功！')
    console.log('━'.repeat(50))
  } catch (err) {
    clearTimeout(globalTimer)
    fail(err?.message ?? String(err))
    return  // fail() calls process.exit(1) asynchronously; return prevents fall-through
  } finally {
    if (ws1) ws1.terminate()
    if (ws2) ws2.terminate()
    await killHub()
  }

  process.exit(0)
}

main()
