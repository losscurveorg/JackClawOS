/**
 * weather-plugin — Example JackClaw Plugin
 *
 * Commands:
 *   /weather [city]  → 查询天气（默认北京）
 *
 * Uses wttr.in API — no key needed.
 *
 * @example
 * ```ts
 * import weatherPlugin from '@jackclaw/sdk/examples/weather'
 * // register with node
 * ```
 */
import { definePlugin } from '../index.js'
import https from 'https'

function fetchWeather(city: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=3`
    https.get(url, { headers: { 'User-Agent': 'JackClaw/1.0' } }, (res) => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => resolve(d.trim()))
    }).on('error', reject)
  })
}

export default definePlugin({
  name: 'weather',
  version: '1.0.0',
  description: '查询任意城市天气（wttr.in，无需 API key）',

  commands: {
    weather: async (ctx) => {
      const city = ctx.args[0] ?? '北京'
      ctx.log.info(`Fetching weather for: ${city}`)
      try {
        const result = await fetchWeather(city)
        return { text: `🌤 ${result}` }
      } catch (e: any) {
        return { text: `⚠️ 天气查询失败: ${e.message}` }
      }
    },
  },

  schedule: {
    daily: async (ctx) => {
      try {
        const result = await fetchWeather('北京')
        await ctx.report({
          summary: `今日天气: ${result}`,
          items: [{ label: '数据来源', value: 'wttr.in' }],
        })
      } catch (e: any) {
        ctx.log.warn('Daily weather report failed:', e.message)
      }
    },
  },
})
