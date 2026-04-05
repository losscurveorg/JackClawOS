/**
 * JackClaw Hub - Directory Store
 *
 * Singleton store for handle → AgentProfile mappings.
 * Single source of truth for all handle/node lookups.
 * Used by routes/directory.ts (HTTP handlers) and presence.ts.
 */

import fs from 'fs'
import path from 'path'
import type { AgentProfile } from '@jackclaw/protocol'
import { normalizeAgentAddress, parseHandle } from '@jackclaw/protocol'

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const DIRECTORY_FILE = path.join(HUB_DIR, 'directory.json')

function loadJSON<T>(file: string, defaultVal: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return defaultVal
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

class DirectoryStore {
  private entries: Record<string, AgentProfile>

  constructor() {
    this.entries = loadJSON<Record<string, AgentProfile>>(DIRECTORY_FILE, {})
  }

  /** Register or update a handle entry. Overwrites if same nodeId. */
  registerHandle(handle: string, profile: AgentProfile): void {
    this.entries[handle] = { ...profile, lastSeen: Date.now() }
    this._persist()
  }

  /** Get the nodeId for a handle. Returns null if not registered.
   *  Accepts any address form: @jack, @jack.jackclaw, jack@jackclaw.ai, etc.
   */
  getNodeIdForHandle(handle: string): string | null {
    return this._resolve(handle)?.nodeId ?? null
  }

  /** Get all handles associated with a nodeId. */
  getHandlesForNode(nodeId: string): string[] {
    return Object.entries(this.entries)
      .filter(([, p]) => p.nodeId === nodeId)
      .map(([h]) => h)
  }

  /** Update nodeId for an existing handle (node reconnects with new ID). */
  updateNodeId(handle: string, newNodeId: string): void {
    const key = handle.startsWith('@') ? handle : `@${handle}`
    if (this.entries[key]) {
      this.entries[key].nodeId = newNodeId
      this._persist()
    }
  }

  /** Remove a handle and clean up all its associations. */
  removeHandle(handle: string): void {
    const key = handle.startsWith('@') ? handle : `@${handle}`
    delete this.entries[key]
    this._persist()
  }

  /** Get full profile for a handle.
   *  Accepts any address form: @jack, @jack.jackclaw, jack@jackclaw.ai, etc.
   */
  getProfile(handle: string): AgentProfile | null {
    return this._resolve(handle)
  }

  /** Update lastSeen timestamp for a handle. */
  touchHandle(handle: string): void {
    const key = handle.startsWith('@') ? handle : `@${handle}`
    if (this.entries[key]) {
      this.entries[key].lastSeen = Date.now()
      this._persist()
    }
  }

  /** List all public profiles. */
  listPublic(): AgentProfile[] {
    return Object.values(this.entries).filter(p => p.visibility === 'public')
  }

  /** Expose raw entries for backward-compat with route-level code. */
  getAll(): Record<string, AgentProfile> {
    return { ...this.entries }
  }

  private _persist(): void {
    saveJSON(DIRECTORY_FILE, this.entries)
  }

  /** Resolve any handle variant to a stored profile.
   *  Tries: canonical (@jack.jackclaw), then short form (@jack).
   *  This ensures backward-compat with entries registered before alias support.
   */
  private _resolve(handle: string): AgentProfile | null {
    const canonical = normalizeAgentAddress(handle)   // e.g. "@jack.jackclaw"
    if (this.entries[canonical]) return this.entries[canonical]

    // Fallback: short form  @jack
    const parsed = parseHandle(handle)
    if (parsed) {
      const short = `@${parsed.local}`
      if (this.entries[short]) return this.entries[short]
    }

    // Last resort: bare key with @ prefix (handles non-standard forms)
    const bare = handle.startsWith('@') ? handle : `@${handle}`
    return this.entries[bare] ?? null
  }
}

export const directoryStore = new DirectoryStore()
