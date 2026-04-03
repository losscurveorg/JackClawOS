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

export class WorkloadTracker {
  private snapshot: WorkloadSnapshot

  constructor(private nodeId: string) {
    this.snapshot = {
      nodeId,
      activeTasks: 0,
      queuedTasks: 0,
      completedToday: 0,
      avgResponseTimeMs: 0,
      updatedAt: Date.now(),
    }
  }

  increment(field: "activeTasks" | "queuedTasks") {
    this.snapshot[field]++
    this.snapshot.updatedAt = Date.now()
  }

  decrement(field: "activeTasks" | "queuedTasks") {
    this.snapshot[field] = Math.max(0, this.snapshot[field] - 1)
    this.snapshot.updatedAt = Date.now()
  }

  recordCompletion(durationMs: number) {
    this.snapshot.completedToday++
    this.snapshot.activeTasks = Math.max(0, this.snapshot.activeTasks - 1)
    this.snapshot.avgResponseTimeMs =
      (this.snapshot.avgResponseTimeMs * (this.snapshot.completedToday - 1) + durationMs) /
      this.snapshot.completedToday
    this.snapshot.updatedAt = Date.now()
  }

  getSnapshot(): WorkloadSnapshot {
    return { ...this.snapshot }
  }
}
