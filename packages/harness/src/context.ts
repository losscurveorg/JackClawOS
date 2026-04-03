/**
 * HarnessContext — JackClaw 给每个 Harness Session 注入的能力包
 *
 * 每次 spawn 时由 JackClaw 自动构建并注入，Harness 实现可直接使用。
 */

export interface MemoryEntry {
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
  tags?: string[]
}

export interface AuditEvent {
  sessionId: string
  harness: string
  nodeId: string
  event: 'spawn' | 'output' | 'complete' | 'error' | 'human-review' | 'killed'
  data?: unknown
  ts: number
}

export interface ChatNotification {
  type: 'task-started' | 'task-complete' | 'task-failed' | 'human-review-needed'
  sessionId: string
  summary: string
  attachments?: Array<{ name: string; content: string }>
}

/**
 * HarnessContext — 注入到每个 Harness Session 的能力包
 */
export interface HarnessContext {
  nodeId: string
  hubUrl: string

  /** Memory：任务开始前注入，任务结束后写回 */
  memory: {
    /** 获取与当前任务相关的 memory 条目 */
    getRelevant(query: string, limit?: number): Promise<MemoryEntry[]>
    /** 写入新的 memory 条目（任务完成后调用） */
    write(entry: MemoryEntry): Promise<void>
    /** 批量写入 */
    writeBatch(entries: MemoryEntry[]): Promise<void>
  }

  /** 审计：每个关键事件自动记录 */
  audit: {
    log(event: Omit<AuditEvent, 'ts'>): void
    getLog(sessionId: string): AuditEvent[]
  }

  /** ClawChat：任务状态推送给人类主人 */
  chat: {
    notify(n: ChatNotification): Promise<void>
    /** 发起 Human-in-Loop：暂停执行等待人工确认 */
    requestApproval(sessionId: string, summary: string, timeout?: number): Promise<'approved' | 'rejected'>
  }

  /** AutoRetry 配置（软失败自愈） */
  retry: {
    enabled: boolean
    maxAttempts: number
    /** 判断输出是否成功的自定义函数 */
    successEvaluator?: (output: string) => boolean
  }

  /** PaymentVault（可选，付费任务用） */
  payment?: {
    taskBudget: number          // 本任务最大预算（USD）
    authorize(): Promise<boolean>
    charge(amount: number, description: string): Promise<void>
  }
}

/** 构建默认 HarnessContext（无 payment） */
export function buildDefaultContext(opts: {
  nodeId: string
  hubUrl: string
  chatNotifyFn?: (n: ChatNotification) => Promise<void>
}): HarnessContext {
  const auditLog: Map<string, AuditEvent[]> = new Map()

  return {
    nodeId: opts.nodeId,
    hubUrl: opts.hubUrl,

    memory: {
      async getRelevant(_query, _limit = 10) {
        // 默认实现：从 Hub memory API 拉取
        // 实际项目中接入 @jackclaw/memory
        return []
      },
      async write(_entry) { /* 接入 memory store */ },
      async writeBatch(_entries) { /* 接入 memory store */ },
    },

    audit: {
      log(event) {
        const full: AuditEvent = { ...event, ts: Date.now() }
        const list = auditLog.get(event.sessionId) ?? []
        list.push(full)
        auditLog.set(event.sessionId, list)
        console.log(`[audit] ${event.harness} ${event.event} session=${event.sessionId}`)
      },
      getLog(sessionId) {
        return auditLog.get(sessionId) ?? []
      },
    },

    chat: {
      async notify(n) {
        console.log(`[chat] ${n.type}: ${n.summary}`)
        await opts.chatNotifyFn?.(n)
      },
      async requestApproval(_sessionId, summary, timeoutMs = 300000) {
        console.log(`[chat] Human approval needed: ${summary}`)
        // 实际：通过 ClawChat 推送消息，等待 type:'ask' 回复
        // 默认 dev 模式：自动批准
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve('approved'), timeoutMs)
          // 可接入外部信号取消
          timer.unref?.()
        })
      },
    },

    retry: {
      enabled: true,
      maxAttempts: 3,
    },
  }
}
