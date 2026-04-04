/**
 * JackClaw Hub - Presence API Routes
 *
 * GET /api/presence/:handle  — query online state for a @handle
 * GET /api/presence/online   — list all currently online @handles
 */

import { Router, Request, Response } from 'express'
import { presenceManager } from '../presence'

const router = Router()

// GET /api/presence/online — list all online @handles
// NOTE: this route must be registered BEFORE /:handle to avoid shadowing
router.get('/online', (_req: Request, res: Response) => {
  const handles = presenceManager.getOnlineHandles()
  return res.json({ handles, count: handles.length })
})

// GET /api/presence/:handle — presence info for a specific @handle
router.get('/:handle', (req: Request, res: Response) => {
  const handle   = decodeURIComponent(req.params.handle)
  const resolved = presenceManager.resolveHandle(handle)
  const presence = presenceManager.getPresence(handle)

  return res.json({
    handle,
    nodeId:            resolved.nodeId,
    online:            resolved.online,
    wsConnected:       resolved.wsConnected,
    lastSeen:          presence.lastSeen,
    connectedChannels: presence.connectedChannels,
  })
})

export default router
