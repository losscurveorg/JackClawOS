# @jackclaw/sdk

JackClaw Plugin Development SDK — build AI agent plugins in minutes.

[English](#english) | [中文](#中文)

---

<a id="english"></a>
## English

### Install

```bash
npm install @jackclaw/sdk
```

### Create a Plugin

```ts
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  description: 'What this plugin does',

  // Slash commands: /hello world
  commands: {
    hello: async (ctx) => {
      const name = ctx.args[0] ?? 'world'
      return { text: `Hello, ${name}! I am ${ctx.node.name}.` }
    },
  },

  // Scheduled tasks
  schedule: {
    daily: async (ctx) => {
      await ctx.report({ summary: 'Daily check complete' })
    },
  },

  // Lifecycle hooks
  hooks: {
    onLoad: async (ctx) => ctx.log.info('Plugin loaded'),
  },
})
```

### Built-in Examples

| Plugin | Description |
|--------|-------------|
| `examples/weather-plugin` | Query weather via wttr.in (no key needed) |
| `examples/translator-plugin` | Translate text via LLM Gateway |
| `examples/daily-reporter-plugin` | Log work items + daily auto-report |

### Test Your Plugin

```ts
import { createMockCommandContext } from '@jackclaw/sdk'
import myPlugin from './my-plugin'

const ctx = createMockCommandContext({ args: ['Alice'] })
const result = await myPlugin.commands!.hello!(ctx)
console.assert(result?.text === 'Hello, Alice!')
```

---

<a id="中文"></a>
## 中文

### 安装

```bash
npm install @jackclaw/sdk
```

### 快速写一个 Plugin

```ts
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: '我的插件',
  version: '1.0.0',

  commands: {
    // /hello 张三 → 回复问候
    hello: async (ctx) => {
      const name = ctx.args[0] ?? '朋友'
      return { text: `你好，${name}！我是 ${ctx.node.name}。` }
    },
  },

  schedule: {
    daily: async (ctx) => {
      // 每天自动发送日报
      await ctx.report({ summary: '今日检查完成' })
    },
  },
})
```

### Plugin 能做什么

- **commands** — 响应 `/命令` 消息
- **schedule** — 定时任务（每日/每小时/自定义 cron）
- **hooks** — 生命周期钩子（onLoad/onShutdown）
- **store** — 持久化键值存储
- **log** — 结构化日志

### 内置示例

```ts
// 天气查询（无需 API key）
import weatherPlugin from '@jackclaw/sdk/examples/weather-plugin'

// 多语言翻译
import translatorPlugin from '@jackclaw/sdk/examples/translator-plugin'

// 自动日报
import dailyReporter from '@jackclaw/sdk/examples/daily-reporter-plugin'
```

### 测试

```ts
import { createMockCommandContext } from '@jackclaw/sdk'

const ctx = createMockCommandContext({ args: ['世界'] })
const result = await weatherPlugin.commands!.weather!(ctx)
console.log(result?.text) // 🌤 北京: ☀️ +22°C
```
