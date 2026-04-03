// Hub-side cache for node workload snapshots reported by nodes
// Nodes push their snapshot via POST /api/nodes/:nodeId/workload

export interface WorkloadSnapshot {
  nodeId: string
  activeTasks: number
  queuedTasks: number
  completedToday: number
  avgResponseTimeMs: number
  cpuPct?: number
  memMb?: number
  updatedAt: number
}

// In-memory cache — workload data is ephemeral; no need to persist across hub restarts
const cache = new Map<string, WorkloadSnapshot>()

export function setWorkload(nodeId: string, snapshot: WorkloadSnapshot): void {
  cache.set(nodeId, { ...snapshot, nodeId })
}

export function getWorkload(nodeId: string): WorkloadSnapshot | null {
  return cache.get(nodeId) ?? null
}

export function getAllWorkloads(): Record<string, WorkloadSnapshot> {
  return Object.fromEntries(cache.entries())
}
