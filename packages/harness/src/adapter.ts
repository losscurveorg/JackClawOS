/**
 * Harness Adapter 接口 — 所有 ACP Harness 工具的统一抽象
 *
 * 实现此接口即可接入 JackClaw 生态：
 * - 自动获得 memory 注入/写回
 * - AutoRetry 软失败自愈
 * - ClawChat 通道
 * - 审计日志
 * - PaymentVault（可选）
 */

import type { HarnessContext } from './context'

export type HarnessName =
  | 'codex'
  | 'claude-code'
  | 'cursor'
  | 'gemini'
  | 'opencode'
  | 'aider'
  | string   // 支持自定义

export interface HarnessTask {
  id: string
  title: string
  description: string
  workdir: string               // 工作目录
  files?: string[]              // 相关文件列表（可选，用于 memory 上下文过滤）
  timeoutMs?: number            // 默认 300000 (5min)
  requireHumanApproval?: boolean // 完成前需要人工确认
}

export interface HarnessSession {
  id: string
  harness: HarnessName
  task: HarnessTask
  startedAt: number
  pid?: number
}

export interface HarnessOutput {
  sessionId: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  filesChanged?: string[]       // 检测到变更的文件列表
}

export interface HarnessResult {
  session: HarnessSession
  output: HarnessOutput
  status: 'success' | 'failed' | 'timeout' | 'human-rejected'
  attempts: number              // AutoRetry 实际重试次数
  memoryWritten: boolean        // 是否写回了 memory
  auditId: string               // 审计日志 ID
}

/**
 * HarnessAdapter — 每种 ACP 工具实现此接口
 */
export interface HarnessAdapter {
  readonly name: HarnessName

  /** 检测该工具是否已安装/可用 */
  isAvailable(): Promise<boolean>

  /**
   * 启动一个 Harness Session
   * - 实现负责：进程启动、stdin/stdout 管道
   * - JackClaw 负责：memory 注入、超时、审计
   */
  spawn(task: HarnessTask, context: HarnessContext): Promise<ActiveSession>
}

/**
 * ActiveSession — spawn() 返回的活跃会话句柄
 */
export interface ActiveSession {
  sessionId: string
  pid?: number

  /** 等待执行完成，返回原始输出 */
  wait(): Promise<HarnessOutput>

  /** 发送追加输入（某些 Harness 支持交互） */
  send?(input: string): Promise<void>

  /** 强制终止 */
  kill(): Promise<void>

  /** 订阅实时输出 */
  onOutput?(cb: (chunk: string) => void): void
}
