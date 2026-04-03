/**
 * daily-reporter-plugin — Example JackClaw Plugin
 *
 * 每天自动汇总工作内容并向 Hub 发送日报。
 * 展示: schedule + report + store 用法
 */
import { definePlugin } from '../index.js'

export default definePlugin({
  name: 'daily-reporter',
  version: '1.0.0',
  description: '每日自动汇报工作内容',

  commands: {
    // /log <message> — 记录今日工作
    log: async (ctx) => {
      const msg = ctx.args.join(' ')
      if (!msg) return { text: '用法: /log <工作内容>' }

      const today = new Date().toISOString().slice(0, 10)
      const key = `log:${today}`
      const existing: string[] = (ctx.store.get(key) as string[]) ?? []
      existing.push(`${new Date().toLocaleTimeString()} - ${msg}`)
      ctx.store.set(key, existing)

      return { text: `✅ 已记录 (${existing.length} 条)` }
    },

    // /summary — 查看今日汇总
    summary: async (ctx) => {
      const today = new Date().toISOString().slice(0, 10)
      const key = `log:${today}`
      const logs: string[] = (ctx.store.get(key) as string[]) ?? []

      if (!logs.length) return { text: '今日暂无工作记录' }

      return {
        text: `📋 ${today} 工作日志 (${logs.length} 条):\n${logs.map((l, i) => `${i+1}. ${l}`).join('\n')}`,
      }
    },
  },

  schedule: {
    daily: async (ctx) => {
      const today = new Date().toISOString().slice(0, 10)
      const key = `log:${today}`
      const logs: string[] = (ctx.store.get(key) as string[]) ?? []

      if (!logs.length) {
        await ctx.notify('📋 今日无工作记录，请使用 /log 记录工作内容')
        return
      }

      await ctx.report({
        summary: `今日完成 ${logs.length} 项工作`,
        items: logs.map((l, i) => ({ label: `工作 ${i+1}`, value: l })),
        data: { date: today, count: logs.length },
      })

      ctx.log.info(`Daily report sent: ${logs.length} items`)
    },
  },
})
