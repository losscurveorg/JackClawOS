/**
 * JackClaw Hub — Audit Logger
 *
 * Append-only JSONL audit trail at ~/.jackclaw/hub/audit.jsonl.
 * Tracks: login, register, message_send, file_upload, admin_action, security_alert.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

const AUDIT_FILE = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub', 'audit.jsonl')

export type AuditEventType =
  | 'login'
  | 'register'
  | 'message_send'
  | 'file_upload'
  | 'admin_action'
  | 'security_alert'

export interface AuditEvent {
  id: string
  type: AuditEventType
  timestamp: number
  ip?: string
  handle?: string
  nodeId?: string
  details: Record<string, unknown>
}

export interface AuditQueryFilters {
  type?: AuditEventType
  handle?: string
  nodeId?: string
  fromTs?: number
  toTs?: number
  /** Max results returned (default 1000, applied from newest) */
  limit?: number
}

// ─── AuditLogger ─────────────────────────────────────────────────────────────

export class AuditLogger {
  private readonly logFile: string

  constructor(logFile = AUDIT_FILE) {
    this.logFile = logFile
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true })
  }

  /**
   * Append an audit event to the log.
   * The file is opened with O_APPEND — safe for concurrent writes on the same host.
   * Entries are never modified or deleted.
   */
  log(
    type: AuditEventType,
    details: Record<string, unknown> & { ip?: string; handle?: string; nodeId?: string },
  ): void {
    const { ip, handle, nodeId, ...rest } = details
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      ...(ip !== undefined && { ip }),
      ...(handle !== undefined && { handle }),
      ...(nodeId !== undefined && { nodeId }),
      details: rest,
    }
    fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n', { encoding: 'utf-8', flag: 'a' })
  }

  /**
   * Query the audit log.
   * Reads the entire file and filters in-memory.
   * For large deployments, consider streaming or an indexed store.
   */
  query(filters: AuditQueryFilters = {}): AuditEvent[] {
    if (!fs.existsSync(this.logFile)) return []

    const raw = fs.readFileSync(this.logFile, 'utf-8')
    const events: AuditEvent[] = []

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as AuditEvent)
      } catch { /* skip malformed lines */ }
    }

    let result = events
    if (filters.type)    result = result.filter(e => e.type === filters.type)
    if (filters.handle)  result = result.filter(e => e.handle === filters.handle)
    if (filters.nodeId)  result = result.filter(e => e.nodeId === filters.nodeId)
    if (filters.fromTs)  result = result.filter(e => e.timestamp >= filters.fromTs!)
    if (filters.toTs)    result = result.filter(e => e.timestamp <= filters.toTs!)

    // Return the newest N events
    const limit = filters.limit ?? 1000
    return result.slice(-limit)
  }
}

/** Singleton logger — use this in route handlers. */
export const auditLogger = new AuditLogger()
