/**
 * HarnessSession — JackClaw 统一 Session 编排器
 *
 * 职责：
 * 1. spawn 前：从 memory 注入相关上下文
 * 2. 执行中：实时审计、超时保护、输出流监控
 * 3. 执行后：AutoRetry 软失败自愈、Human-in-Loop、memory 写回
 * 4. 全程：ClawChat 状态推送
 */

import { randomUUID } from 'crypto'
import type { HarnessAdapter, HarnessTask, HarnessResult, HarnessOutput } from './adapter'
import type { HarnessContext } from './context'

export class JackClawSession {
  private sessionId = randomUUID()
  private startedAt = Date.now()

  constructor(
    private adapter: HarnessAdapter,
    private task: HarnessTask,
    private context: HarnessContext,
  ) {}

  async run(): Promise<HarnessResult> {
    const { context, task, adapter } = this
    const { audit, chat, memory, retry } = context

    audit.log({ sessionId: this.sessionId, harness: adapter.name, nodeId: context.nodeId, event: 'spawn', data: { taskId: task.id, title: task.title } })

    // 1. 注入 memory 上下文
    const relevantMemory = await memory.getRelevant(task.description, 10)
    const enrichedTask: HarnessTask = relevantMemory.length > 0
      ? {
          ...task,
          description: task.description +
            '\n\n## Relevant Context (from memory)\n' +
            relevantMemory.map(e => `[${e.type}] ${e.content}`).join('\n'),
        }
      : task

    // 2. 通知任务开始
    await chat.notify({
      type: 'task-started',
      sessionId: this.sessionId,
      summary: `[${adapter.name}] 开始执行：${task.title}`,
    })

    // 3. 执行（带 AutoRetry）
    let output: HarnessOutput | null = null
    let attempts = 0
    let lastError: Error | null = null

    const maxAttempts = retry.enabled ? retry.maxAttempts : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt
      try {
        const active = await adapter.spawn(enrichedTask, context)

        // 超时保护
        const timeoutMs = task.timeoutMs ?? 300000
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        )

        output = await Promise.race([active.wait(), timeoutPromise])

        audit.log({ sessionId: this.sessionId, harness: adapter.name, nodeId: context.nodeId, event: 'output', data: { exitCode: output.exitCode, attempt } })

        // 判断是否成功
        const succeeded = output.exitCode === 0 &&
          (retry.successEvaluator ? retry.successEvaluator(output.stdout) : true)

        if (succeeded) break

        // 软失败：继续重试
        if (attempt < maxAttempts) {
          console.log(`[harness] attempt=${attempt} exitCode=${output.exitCode}, retrying...`)
          lastError = new Error(`Exit code ${output.exitCode}`)
        }
      } catch (err: any) {
        lastError = err
        audit.log({ sessionId: this.sessionId, harness: adapter.name, nodeId: context.nodeId, event: 'error', data: { error: err.message, attempt } })
        if (attempt === maxAttempts) break
      }
    }

    if (!output) {
      output = {
        sessionId: this.sessionId,
        stdout: '',
        stderr: lastError?.message ?? 'Unknown error',
        exitCode: 1,
        durationMs: Date.now() - this.startedAt,
      }
    }

    const succeeded = output.exitCode === 0 &&
      (retry.successEvaluator ? retry.successEvaluator(output.stdout) : true)

    // 4. Human-in-Loop
    let humanStatus: 'approved' | 'rejected' = 'approved'
    if (task.requireHumanApproval && succeeded) {
      await chat.notify({
        type: 'human-review-needed',
        sessionId: this.sessionId,
        summary: `[${adapter.name}] 任务完成，等待确认：${task.title}`,
        attachments: output.stdout
          ? [{ name: 'output.txt', content: output.stdout.slice(0, 2000) }]
          : undefined,
      })
      humanStatus = await chat.requestApproval(this.sessionId, task.title)
    }

    // 5. memory 写回（成功且人工批准）
    let memoryWritten = false
    if (succeeded && humanStatus === 'approved' && output.stdout) {
      await memory.writeBatch([
        {
          type: 'project',
          content: `[${adapter.name}] 完成任务「${task.title}」，耗时 ${Math.round(output.durationMs / 1000)}s，重试 ${attempts} 次`,
          tags: [adapter.name, task.id, 'completed'],
        },
        ...(output.filesChanged?.length ? [{
          type: 'reference' as const,
          content: `任务「${task.title}」变更文件：${output.filesChanged.join(', ')}`,
          tags: ['files-changed', task.id],
        }] : []),
      ])
      memoryWritten = true
    }

    // 6. 最终通知
    const finalStatus = humanStatus === 'rejected'
      ? 'human-rejected'
      : succeeded ? 'success' : 'failed'

    await chat.notify({
      type: finalStatus === 'success' ? 'task-complete' : 'task-failed',
      sessionId: this.sessionId,
      summary: `[${adapter.name}] ${finalStatus === 'success' ? '✅ 完成' : '❌ 失败'}：${task.title}（${attempts} 轮）`,
    })

    audit.log({ sessionId: this.sessionId, harness: adapter.name, nodeId: context.nodeId, event: 'complete', data: { status: finalStatus, attempts } })

    return {
      session: {
        id: this.sessionId,
        harness: adapter.name,
        task,
        startedAt: this.startedAt,
      },
      output,
      status: finalStatus,
      attempts,
      memoryWritten,
      auditId: this.sessionId,
    }
  }
}
