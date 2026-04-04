/**
 * Hub Web Push Routes
 *
 * GET  /api/push/vapid-key   — get VAPID public key (needed by frontend before subscribing)
 * POST /api/push/subscribe   — register a push subscription for a node
 * POST /api/push/unsubscribe — cancel a push subscription
 * POST /api/push/test        — send a test push notification
 */

import { Router, Request, Response } from 'express'
import { pushService, type WebPushSubscription } from '../push-service'

const router = Router()

// GET /api/push/vapid-key
// Returns the VAPID application server public key (base64url).
// Frontend must use this when calling PushManager.subscribe({ applicationServerKey }).
router.get('/vapid-key', (_req: Request, res: Response) => {
  res.json({ publicKey: pushService.getVapidPublicKey() })
})

// POST /api/push/subscribe
// Body: { nodeId: string, subscription: PushSubscriptionJSON }
router.post('/subscribe', (req: Request, res: Response) => {
  const { nodeId, subscription } = req.body as {
    nodeId?: string
    subscription?: WebPushSubscription
  }

  if (!nodeId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: 'nodeId and subscription (endpoint, keys.p256dh, keys.auth) required' })
    return
  }

  pushService.subscribe(nodeId, subscription)
  res.json({ status: 'ok', nodeId })
})

// POST /api/push/unsubscribe
// Body: { nodeId: string }
router.post('/unsubscribe', (req: Request, res: Response) => {
  const { nodeId } = req.body as { nodeId?: string }

  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }

  pushService.unsubscribe(nodeId)
  res.json({ status: 'ok', nodeId })
})

// POST /api/push/test
// Body: { nodeId?: string }  — if omitted, broadcasts to all subscribers
router.post('/test', async (req: Request, res: Response) => {
  const { nodeId } = req.body as { nodeId?: string }

  const payload = {
    title: 'JackClaw Test Push',
    body: `Push notification works! ${new Date().toLocaleTimeString()}`,
    data: { type: 'test' },
  }

  if (nodeId) {
    const sent = await pushService.push(nodeId, payload)
    res.json({ status: sent ? 'sent' : 'no_subscription', nodeId })
  } else {
    await pushService.pushToAll(payload)
    res.json({ status: 'broadcast', count: pushService.subscriptionCount() })
  }
})

export default router
