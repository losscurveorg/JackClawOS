/**
 * JackClaw Hub - Unified Offline Queue
 *
 * Persists queued messages for offline handles.
 * Keyed by target @handle (not nodeId) so messages survive node ID changes.
 *
 * Each enqueued item is a { event, data } envelope ready to be sent over WS.
 * Persisted to ~/.jackclaw/hub/offline-queue.json.
 */

import fs from 'fs'
import path from 'path'

const HUB_DIR    = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const QUEUE_FILE = path.join(HUB_DIR, 'offline-queue.json')

export interface QueuedEnvelope {
  event: string
  data:  unknown
}

function loadJSON<T>(file: string, defaultVal: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return defaultVal
}

class OfflineQueue {
  private queue: Record<string, QueuedEnvelope[]>

  constructor() {
    this.queue = loadJSON<Record<string, QueuedEnvelope[]>>(QUEUE_FILE, {})
  }

  /** Add a message to the offline queue for a target handle. */
  enqueue(targetHandle: string, message: QueuedEnvelope): void {
    const key = this._key(targetHandle)
    const q   = this.queue[key] ?? []
    q.push(message)
    this.queue[key] = q
    this._persist()
  }

  /** Drain (remove and return) all queued messages for a handle. */
  dequeue(targetHandle: string): QueuedEnvelope[] {
    const key  = this._key(targetHandle)
    const msgs = this.queue[key] ?? []
    if (msgs.length > 0) {
      delete this.queue[key]
      this._persist()
    }
    return msgs
  }

  /** Count pending messages without consuming them. */
  peek(targetHandle: string): number {
    return (this.queue[this._key(targetHandle)] ?? []).length
  }

  private _key(handle: string): string {
    return handle.startsWith('@') ? handle : `@${handle}`
  }

  private _persist(): void {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true })
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2), 'utf-8')
  }
}

export const offlineQueue = new OfflineQueue()
