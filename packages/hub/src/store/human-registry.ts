/**
 * Human Registry — 人类账号 ↔ 设备推送映射
 *
 * 解决场景：
 * 一条消息发给 ["bob-human", "bob-node"]
 * - bob-node → AI Agent 处理（ClawChat WebSocket）
 * - bob-human → 推送到 Bob 的设备（飞书/ClawChat App/手机）
 *
 * Human 注册时提供 webhookUrl（或 OpenClaw nodeId），
 * Hub 收到 to 包含 humanId 的消息时，通过 webhook 推送
 */

import { randomUUID } from 'crypto'

export interface HumanAccount {
  humanId: string          // 唯一标识，如 "bob-human"
  displayName: string
  agentNodeId?: string     // 关联的 AI Agent nodeId（bob-node）
  webhookUrl?: string      // 推送 URL（OpenClaw 实例 / ClawChat App）
  feishuOpenId?: string    // 飞书 open_id（走飞书推送）
  registeredAt: number
  lastSeenAt?: number
}

const humans = new Map<string, HumanAccount>()

export function registerHuman(account: Omit<HumanAccount, 'registeredAt'>): HumanAccount {
  const h: HumanAccount = { ...account, registeredAt: Date.now() }
  humans.set(account.humanId, h)
  return h
}

export function getHuman(humanId: string): HumanAccount | undefined {
  return humans.get(humanId)
}

export function listHumans(): HumanAccount[] {
  return [...humans.values()]
}

/**
 * 判断一个 target 是人类账号还是 Agent Node
 * 约定：humanId 以 "h:" 开头，或已注册到 HumanRegistry
 */
export function isHumanTarget(target: string): boolean {
  return target.startsWith('h:') || humans.has(target)
}

/**
 * 把消息推送到人类账号的设备
 * 支持：webhook（任意 HTTP 端点）| 飞书（后续扩展）
 */
export async function pushToHuman(
  human: HumanAccount,
  message: { from: string; content: string; type: string; id: string },
): Promise<void> {
  if (human.webhookUrl) {
    try {
      await fetch(human.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'message', data: message }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (e) {
      console.warn(`[human-registry] Push to ${human.humanId} failed:`, (e as Error).message)
    }
  }
  // feishu 推送 — 通过 JACKCLAW_HUB 的 feishu channel 路由（未来扩展）
}
