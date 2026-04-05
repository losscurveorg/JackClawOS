#!/usr/bin/env node
/**
 * Team E2E — AI 团队协作链路验证
 *
 * 验证完整链路：
 *   启动 Hub → 注册用户 → AutoReplyHandler (echo) →
 *   CEO→CTO DM → CEO→CMO DM → 群组广播
 *
 * Usage: node tests/team-e2e.mjs
 */

import { createRequire } from 'module'
import http from 'http'
import { spawn } from 'child_process'
import crypto from 'crypto'

const _require = createRequire(import.meta.url)
const { AutoReplyHandler } = _require('../packages/node/dist/auto-reply.js')

const HUB_PORT   = 3194
const HUB_URL    = `http://localhost:${HUB_PORT}`
const TIMEOUT_MS = 20_000

let hubProcess = null
const autoHandlers = []    // AutoReplyHandler instances to stop on cleanup

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

function pass(msg) { console.log(`  ✅ ${msg}`) }

function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}`)
  doCleanup().finally(() => process.exit(1))
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

function waitFor(ms) { return new Promise(r => setTimeout(r, ms)) }

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (data)  headers['Content-Length'] = Buffer.byteLength(data)
    if (token) headers['Authorization']  = `Bearer ${token}`

    const req = http.request(
      { hostname: 'localhost', port: HUB_PORT, path, method, headers },
      (res) => {
        let buf = ''
        res.on('data', c => (buf += c))
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

const post = (path, body, token) => request('POST', path, body, token)
const get  = (path, token)       => request('GET',  path, null, token)

async function waitForPort(port, timeoutMs = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await get('/health')
      if (r.status === 200) return true
    } catch {}
    await waitFor(300)
  }
  return false
}

/** Poll /api/chat/inbox for a message from a specific sender, up to 8 s */
async function pollInbox(recipientNodeId, fromNodeId, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await get(`/api/chat/inbox?nodeId=${encodeURIComponent(recipientNodeId)}`)
    if (r.status === 200 && Array.isArray(r.body.messages)) {
      const match = r.body.messages.find(m => m.from === fromNodeId)
      if (match) return match
    }
    await waitFor(400)
  }
  throw new Error(`Timed out waiting for message from ${fromNodeId} in ${recipientNodeId}'s inbox`)
}

/** Drain entire inbox for a node (single call, no retry) */
async function drainInbox(nodeId) {
  const r = await get(`/api/chat/inbox?nodeId=${encodeURIComponent(nodeId)}`)
  if (r.status !== 200) throw new Error(`drainInbox ${nodeId} → HTTP ${r.status}`)
  return r.body.messages ?? []
}

async function doCleanup() {
  log('cleanup', 'Stopping AutoReplyHandlers...')
  for (const h of autoHandlers) {
    try { h.stop() } catch {}
  }
  if (hubProcess) {
    hubProcess.kill('SIGTERM')
    await waitFor(600)
    if (!hubProcess.killed) hubProcess.kill('SIGKILL')
    log('cleanup', 'Hub stopped')
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function step1_startHub() {
  log('step1', `Starting Hub on port ${HUB_PORT}`)

  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, HUB_PORT: String(HUB_PORT), NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  hubProcess.stdout.on('data', d => { const l = d.toString().trim(); if (l) log('hub', l) })
  hubProcess.stderr.on('data', d => { const l = d.toString().trim(); if (l) log('hub:err', l) })
  hubProcess.on('exit', code => log('hub', `exited (${code})`))

  const ready = await waitForPort(HUB_PORT)
  if (!ready) { fail('Hub did not start within 12 s'); return null }
  pass('Hub started')
}

async function step2_registerUsers() {
  log('step2', 'Registering cto / cmo / cdo')
  const users = {}
  const roles = {
    cto: { display: 'CTO Agent', prompt: '你是 CTO，负责技术架构决策与系统稳定性。' },
    cmo: { display: 'CMO Agent', prompt: '你是 CMO，负责品牌营销与增长策略。' },
    cdo: { display: 'CDO Agent', prompt: '你是 CDO，负责数据战略与分析。' },
  }

  for (const [handle, meta] of Object.entries(roles)) {
    // Use unique suffix to avoid conflicts with previous runs
    const uniqueHandle = `${handle}${Date.now() % 100000}`
    const r = await post('/api/auth/register', {
      handle:      uniqueHandle,
      password:    'test123',
      displayName: meta.display,
    })
    if (r.status !== 201) {
      throw new Error(`register ${handle}: expected 201, got ${r.status} — ${JSON.stringify(r.body)}`)
    }
    users[handle] = {
      handle:       uniqueHandle,
      token:        r.body.token,
      systemPrompt: meta.prompt,
    }
    pass(`Registered @${uniqueHandle} (${handle})`)
  }
  return users
}

async function step3_createHandlers(users) {
  log('step3', 'Creating AutoReplyHandlers in echo mode')

  for (const [role, user] of Object.entries(users)) {
    const handler = new AutoReplyHandler({
      nodeId:       role,          // use role as nodeId for routing simplicity
      hubUrl:       HUB_URL,
      systemPrompt: user.systemPrompt,
      // no llmGateway / openclawGatewayUrl → echo mode
    })
    handler.start()
    autoHandlers.push(handler)
    user.handler = handler
    log('step3', `AutoReplyHandler started for ${role} (nodeId=${role})`)
  }

  // Give WS connections time to establish
  await waitFor(1200)

  for (const [role, user] of Object.entries(users)) {
    if (!user.handler.isConnected()) {
      throw new Error(`AutoReplyHandler for ${role} did not connect within 1.2 s`)
    }
  }
  pass('All 3 AutoReplyHandlers connected to Hub')
}

async function step4_ceo_to_cto(users) {
  log('step4', 'CEO → CTO: "分析架构"')
  const content = `分析架构：请评估当前微服务的可扩展性 [${Date.now()}]`

  const r = await post('/api/chat/send', {
    id:        crypto.randomUUID(),
    from:      'ceo',
    to:        'cto',
    content,
    type:      'task',
    ts:        Date.now(),
    signature: '',
    encrypted: false,
  })
  assert(r.status === 200, `send returned ${r.status}`)
  log('step4', `Message sent (id=${r.body.messageId})`)

  const reply = await pollInbox('ceo', 'cto')
  assert(typeof reply.content === 'string', 'reply.content must be string')
  assert(reply.content.length > 0, 'reply must not be empty')
  // Echo mode prepends "[echo] 收到：" + original content
  assert(reply.content.includes('[echo]'), `CTO echo reply missing "[echo]": ${reply.content}`)
  pass(`CTO AutoReply received: "${reply.content.slice(0, 60)}..."`)
}

async function step5_ceo_to_cmo(users) {
  log('step5', 'CEO → CMO: "分析市场"')
  const content = `分析市场：Q2 营销策略建议 [${Date.now()}]`

  const r = await post('/api/chat/send', {
    id:        crypto.randomUUID(),
    from:      'ceo',
    to:        'cmo',
    content,
    type:      'task',
    ts:        Date.now(),
    signature: '',
    encrypted: false,
  })
  assert(r.status === 200, `send returned ${r.status}`)

  const reply = await pollInbox('ceo', 'cmo')
  assert(reply.content.includes('[echo]'), `CMO echo reply missing "[echo]": ${reply.content}`)
  pass(`CMO AutoReply received: "${reply.content.slice(0, 60)}..."`)
}

async function step6_group_test(users) {
  log('step6', 'Group test — creating 领导团队')

  // Stop AutoReplyHandlers so group messages queue in their inboxes
  // (handlers are connected via WS; stopping them makes members "offline")
  log('step6', 'Stopping AutoReplyHandlers to force inbox queueing...')
  for (const h of autoHandlers) h.stop()
  await waitFor(800) // allow WS close to propagate

  // Create group
  const grpR = await post('/api/chat/group/create', {
    name:      '领导团队',
    members:   ['ceo', 'cto', 'cmo', 'cdo'],
    createdBy: 'ceo',
    topic:     '战略讨论',
  })
  if (grpR.status !== 200) {
    throw new Error(`group/create failed: ${grpR.status} ${JSON.stringify(grpR.body)}`)
  }
  const groupId = grpR.body.group?.groupId
  assert(groupId, `groupId missing from response: ${JSON.stringify(grpR.body)}`)
  log('step6', `Group created: ${groupId}`)

  // CEO sends group message
  const groupContent = `周会议程：Q2 目标回顾 [${Date.now()}]`
  const sendR = await post('/api/chat/send', {
    id:        crypto.randomUUID(),
    from:      'ceo',
    to:        groupId,
    content:   groupContent,
    type:      'task',
    ts:        Date.now(),
    signature: '',
    encrypted: false,
  })
  assert(sendR.status === 200, `group send returned ${sendR.status}`)
  await waitFor(600) // let hub fan-out complete

  // Verify CTO received the group message
  const ctoInbox = await drainInbox('cto')
  const ctoGroupMsg = ctoInbox.find(m => m.content === groupContent)
  assert(ctoGroupMsg, `CTO did not receive group message. inbox: ${JSON.stringify(ctoInbox.map(m => m.content))}`)
  pass('CTO received group message ✓')

  // Verify CMO received the group message
  const cmoInbox = await drainInbox('cmo')
  const cmoGroupMsg = cmoInbox.find(m => m.content === groupContent)
  assert(cmoGroupMsg, `CMO did not receive group message. inbox: ${JSON.stringify(cmoInbox.map(m => m.content))}`)
  pass('CMO received group message ✓')

  pass('群组广播验证通过 — CTO & CMO 均已收到')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤝 JackClaw Team E2E — AI 团队协作链路测试')
  console.log('━'.repeat(55))
  console.log(`   Hub port:  ${HUB_PORT}`)
  console.log(`   Timeout:   ${TIMEOUT_MS / 1000} s`)
  console.log(`   LLM mode:  echo (no real LLM)`)
  console.log('━'.repeat(55))

  const globalTimer = setTimeout(() => {
    fail(`Global timeout (${TIMEOUT_MS / 1000} s)`)
  }, TIMEOUT_MS)

  try {
    await step1_startHub()
    const users  = await step2_registerUsers()
    await step3_createHandlers(users)
    await step4_ceo_to_cto(users)
    await step5_ceo_to_cmo(users)
    await step6_group_test(users)

    clearTimeout(globalTimer)
    console.log('\n' + '━'.repeat(55))
    console.log('🎉 ALL TEAM E2E TESTS PASSED — AI 团队协作链路验证成功！')
    console.log('━'.repeat(55))
  } catch (err) {
    clearTimeout(globalTimer)
    fail(err.message ?? String(err))
  } finally {
    await doCleanup()
  }
}

main()
