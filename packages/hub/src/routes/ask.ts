/**
 * Hub /api/ask — proxy LLM requests to nodes
 *
 * POST /api/ask  { nodeId?, model?, prompt, systemPrompt?, temperature?, max_tokens? }
 * → 路由到指定 node 的 /api/ask，或自动选一个可用 worker node
 */
import { Router, Request, Response } from 'express'
import http from 'http'
import { getAllNodes, getNode } from '../store/nodes.js'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const { nodeId, prompt, model, systemPrompt, temperature, max_tokens } = req.body

  if (!prompt) {
    res.status(400).json({ error: 'prompt required' })
    return
  }

  // Find target node
  const targetNode = nodeId
    ? getNode(nodeId)
    : getAllNodes().find(n => n.role !== 'ceo' && n.callbackUrl)

  if (!targetNode || !targetNode.callbackUrl) {
    const available = getAllNodes().map(n => n.nodeId)
    res.status(503).json({ error: 'No available node to handle request', available })
    return
  }

  const nodeUrl = new URL('/api/ask', targetNode.callbackUrl)
  const body = JSON.stringify({ prompt, model, systemPrompt, temperature, max_tokens })

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const r = http.request(nodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      }, (resp) => {
        let d = ''
        resp.on('data', c => (d += c))
        resp.on('end', () => {
          try { resolve(JSON.parse(d)) }
          catch { resolve({ error: 'invalid response', raw: d.slice(0, 200) }) }
        })
      })
      r.on('error', reject)
      r.on('timeout', () => { r.destroy(); reject(new Error('Node request timeout')) })
      r.write(body)
      r.end()
    })

    res.json({ ...result, routedTo: targetNode.nodeId })
  } catch (err: any) {
    res.status(502).json({ error: `Node unreachable: ${err.message}`, nodeId: targetNode.nodeId })
  }
})

export default router
