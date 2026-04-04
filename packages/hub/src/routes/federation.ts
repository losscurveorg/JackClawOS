// JackClaw Hub — Federation Routes
// Inter-hub HTTP endpoints for the federation protocol
//
// POST /api/federation/handshake  — Hub-to-hub handshake
// POST /api/federation/message    — Receive a federated message
// GET  /api/federation/peers      — List known peer hubs
// POST /api/federation/discover   — Look up a remote @handle
// GET  /api/federation/status     — Federation health status

import { Router, Request, Response } from 'express'
import type { FederationHandshake, FederatedMessage } from '@jackclaw/protocol'
import { getFederationManager } from '../federation'
import { getHubKeys } from '../server'

const router = Router()

// ─── POST /handshake ──────────────────────────────────────────────────────────

router.post('/handshake', (req: Request, res: Response) => {
  const { handshake } = req.body as { handshake?: FederationHandshake }

  if (!handshake?.hubUrl || !handshake.publicKey || !handshake.ts || !handshake.signature) {
    return res.status(400).json({ error: 'invalid_handshake', required: ['hubUrl', 'publicKey', 'ts', 'signature'] })
  }

  try {
    const mgr = getFederationManager()
    mgr.processInboundHandshake(handshake)

    const { publicKey } = getHubKeys()
    const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`

    return res.json({
      status: 'ok',
      hub: {
        url: myUrl,
        publicKey,
        displayName: process.env.HUB_DISPLAY_NAME,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[federation] Handshake error:', msg)
    return res.status(400).json({ error: 'handshake_failed', message: msg })
  }
})

// ─── POST /message ────────────────────────────────────────────────────────────

router.post('/message', (req: Request, res: Response) => {
  const { federatedMessage } = req.body as { federatedMessage?: FederatedMessage }

  if (!federatedMessage?.id || !federatedMessage.fromHub || !federatedMessage.message) {
    return res.status(400).json({ error: 'invalid_federated_message' })
  }

  try {
    const mgr = getFederationManager()
    const socialMsg = mgr.receiveFromRemoteHub(federatedMessage)

    // Deliver locally using the social module's deliver function
    // We import it lazily to avoid circular deps
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { deliverFederatedMessage } = require('../routes/social') as {
      deliverFederatedMessage: (msg: typeof socialMsg) => void
    }
    deliverFederatedMessage(socialMsg)

    return res.json({ status: 'delivered', messageId: federatedMessage.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[federation] Receive message error:', msg)
    return res.status(500).json({ error: 'delivery_failed', message: msg })
  }
})

// ─── GET /peers ───────────────────────────────────────────────────────────────

router.get('/peers', (_req: Request, res: Response) => {
  const mgr = getFederationManager()
  const peers = mgr.listPeers()
  return res.json({ peers, count: peers.length })
})

// ─── POST /discover ───────────────────────────────────────────────────────────

router.post('/discover', async (req: Request, res: Response) => {
  const { handle } = req.body as { handle?: string }

  if (!handle) {
    return res.status(400).json({ error: 'handle required' })
  }

  const normalized = handle.startsWith('@') ? handle : `@${handle}`

  // Check if this hub has the handle in its local directory
  const dirFile = require('path').join(process.env.HOME || '~', '.jackclaw', 'hub', 'directory.json')
  let localDir: Record<string, { nodeId: string }> = {}
  try {
    const fs = require('fs')
    if (fs.existsSync(dirFile)) {
      localDir = JSON.parse(fs.readFileSync(dirFile, 'utf-8'))
    }
  } catch { /* ignore */ }

  if (localDir[normalized]) {
    const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`
    return res.json({ found: true, handle: normalized, hubUrl: myUrl })
  }

  return res.json({ found: false, handle: normalized })
})

// ─── GET /status ──────────────────────────────────────────────────────────────

router.get('/status', (_req: Request, res: Response) => {
  const mgr = getFederationManager()
  const peers = mgr.listPeers()
  const { publicKey } = getHubKeys()
  const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`

  return res.json({
    hubUrl: myUrl,
    publicKey,
    peerCount: peers.length,
    onlinePeers: peers.filter(p => p.status === 'online').length,
    uptime: mgr.uptimeMs,
  })
})

export default router
