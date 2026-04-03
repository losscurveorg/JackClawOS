# 插件开发指南 — JackClaw OpenClaw Plugin

本文档面向需要扩展 JackClaw OpenClaw Plugin 功能的开发者。

---

## 目录

1. [架构概览](#架构概览)
2. [Heartbeat 钩子](#heartbeat-钩子)
3. [记忆压缩钩子](#记忆压缩钩子)
4. [Agent 工具注册](#agent-工具注册)
5. [如何用飞书/微信/Telegram 接收协作邀请通知](#如何用飞书微信telegram-接收协作邀请通知)
6. [Watchdog 告警如何推送到手机](#watchdog-告警如何推送到手机)
7. [新增自定义工具](#新增自定义工具)

---

## 架构概览

```
OpenClaw Runtime
│
├─ heartbeat 事件 ──→ heartbeat.hook.ts
│                        ├── onHeartbeat()          同步 shared memory → Hub
│                        ├── checkPendingInvites()  检查协作邀请
│                        └── checkWatchdogAlerts()  检查 Watchdog 告警
│
├─ compact 触发   ──→ compact.hook.ts
│                        ├── autoCompact()          L1: 摘要压缩
│                        ├── snipCompact()          L2: 修剪过期 reference
│                        └── crossNodeCompact()     L3: 跨节点去重
│
└─ LLM tool call  ──→ agent-tool.ts
                         ├── jackclaw_mention        @某个 Agent
                         ├── jackclaw_send_task      发送任务
                         ├── jackclaw_check_trust    查信任度
                         └── jackclaw_my_sessions    活跃协作列表
```

---

## Heartbeat 钩子

在 `plugin.ts` 中绑定 OpenClaw 的 `heartbeat` 事件：

```typescript
import { onHeartbeat, checkPendingInvites, checkWatchdogAlerts } from './hooks/heartbeat.hook.js'

api.on('heartbeat', async (_event, ctx) => {
  const nodeId = process.env['JACKCLAW_NODE_ID'] ?? 'default'
  const hubUrl = process.env['JACKCLAW_HUB_URL'] ?? 'http://localhost:3100'

  // 1. 同步本地 shared memory 到 Hub
  await onHeartbeat(nodeId, hubUrl)

  // 2. 检查新的协作邀请
  await checkPendingInvites(nodeId, hubUrl)

  // 3. 检查 Watchdog 告警（critical 级自动推送）
  await checkWatchdogAlerts(nodeId, hubUrl)
})
```

### Shared Memory 文件格式

本地 shared memory 存放于：

```
~/.openclaw/workspace/memory/shared-<nodeId>.json
```

格式为 `SharedMemoryEntry[]`：

```json
[
  {
    "key": "current_project",
    "value": "JackClaw P3 完善 Plugin 集成",
    "type": "working",
    "updatedAt": 1712123456789,
    "lastAccessedAt": 1712123456789
  }
]
```

`type` 字段决定压缩策略：
- `core` — 永不压缩
- `working` — L1 autoCompact 时摘要化
- `reference` — L2 snipCompact 超期后删除

---

## 记忆压缩钩子

参考 Claude Code 三层压缩策略设计：

```typescript
import { autoCompact, snipCompact, crossNodeCompact } from './hooks/compact.hook.js'

// L1: 超过 80% 容量时调用（建议在 heartbeat 内）
const r1 = await autoCompact('my-node-id')
console.log(`autoCompact: -${r1.removed} entries, saved ${r1.saved} bytes`)

// L2: 每日定时修剪（建议每天凌晨）
const r2 = await snipCompact('my-node-id')

// L3: 多节点协作后去重（需 JACKCLAW_CEO_TOKEN）
const r3 = await crossNodeCompact('http://localhost:3100', ['node-a', 'node-b', 'node-c'])
```

被 L2 删除的条目会追加写入 `~/.openclaw/workspace/memory/snip-archive-<nodeId>.jsonl`，可手动恢复。

---

## Agent 工具注册

在 `plugin.ts` 的 `register()` 阶段调用：

```typescript
import { getJackClawTools } from './agent-tool.js'

const nodeId = process.env['JACKCLAW_NODE_ID'] ?? 'default'
for (const tool of getJackClawTools(nodeId)) {
  api.registerTool(tool)
}
```

### 已内置工具一览

| 工具名 | 功能 | 必填参数 |
|---|---|---|
| `jackclaw_mention` | @某个 Agent，发起协作邀请 | `targetNodeId`, `topic` |
| `jackclaw_send_task` | 向某个 Node 发送任务 | `targetNodeId`, `title` |
| `jackclaw_check_trust` | 查询对某个 Agent 的信任评分 | `targetNodeId` |
| `jackclaw_my_sessions` | 列出当前活跃协作会话 | 无 |

---

## 如何用飞书/微信/Telegram 接收协作邀请通知

JackClaw 的协作邀请通知通过 OpenClaw 的 **delivery 管道** 路由到你配置的渠道。

### 飞书

1. 在 `~/.openclaw/config.yaml` 中配置 Feishu 渠道：

```yaml
channels:
  feishu:
    enabled: true
    appId: your_feishu_app_id
    appSecret: your_feishu_app_secret

plugins:
  entries:
    jackclaw:
      path: /path/to/packages/openclaw-plugin
      notifyTo: "ou_xxxxxxxxxxxxxxxx"   # 你的 Feishu open_id
      notifyChannel: "feishu"
```

2. 获取 Feishu open_id：
   - 打开飞书开放平台 → 用户身份 → 获取 open_id
   - 或向机器人发送任意消息后，从 webhook 日志中读取 `sender.open_id`

### 微信（企业微信）

```yaml
plugins:
  entries:
    jackclaw:
      notifyTo: "企业微信用户ID或群机器人 webhook key"
      notifyChannel: "wecom"
```

### Telegram

1. 先获取你的 Telegram Chat ID（向 `@userinfobot` 发送 `/start`）
2. 在配置中填写：

```yaml
plugins:
  entries:
    jackclaw:
      notifyTo: "123456789"    # 你的 Telegram Chat ID
      notifyChannel: "telegram"
```

### 通用说明

- `notifyTo` — 接收通知的用户 ID（格式因渠道而异）
- `notifyChannel` — 与 OpenClaw `channels:` 配置中的 key 对应
- 如果不配置，通知内容会写入 OpenClaw 日志，不推送到手机

---

## Watchdog 告警如何推送到手机

Watchdog 告警推送复用上面相同的 `notifyTo` / `notifyChannel` 配置。以下是完整流程：

### 推送触发逻辑

```
heartbeat 每 60s 触发
  └─ checkWatchdogAlerts(nodeId, hubUrl)
       ├─ 拉取 /api/nodes/{nodeId}/alerts?acknowledged=false
       ├─ 筛选 severity === 'critical'
       ├─ 如有 critical → 立即 emitNotification()
       │     └─ OpenClaw delivery 管道 → 你的手机
       └─ 批量 acknowledge，避免重复推送
```

**info / warning 级别** 告警不立即推送，会在下次日报中汇总展示。

### 告警严重级别说明

| 级别 | 推送时机 | 示例场景 |
|---|---|---|
| `critical` | **立即推送** | 节点失联 > 30min、内存溢出、Hub 写入失败 |
| `warning` | 日报汇总 | 节点响应慢、内存超 70%、任务超时 |
| `info` | 仅记录日志 | 新节点注册、任务完成确认 |

### 手动测试告警推送

向 Hub 写入一条测试告警：

```bash
curl -X POST http://localhost:3100/api/nodes/my-node-id/alerts \
  -H "Authorization: Bearer $JACKCLAW_CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "severity": "critical",
    "message": "测试告警：手动触发",
    "acknowledged": false
  }'
```

然后等待下一次 heartbeat（≤60s），或手动触发：

```
/jackclaw heartbeat
```

---

## 新增自定义工具

在 `agent-tool.ts` 中添加新的 builder 函数，然后在 `getJackClawTools()` 的返回数组中追加：

```typescript
function buildMyCustomTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_my_tool',
    description: '工具功能描述，让 LLM 知道什么时候调用它',
    parameters: {
      type: 'object',
      required: ['requiredParam'],
      properties: {
        requiredParam: { type: 'string', description: '参数说明' },
      },
    },
    async handler(params) {
      const p = params as { requiredParam: string }
      // 实现逻辑...
      return { result: `处理完成：${p.requiredParam}` }
    },
  }
}

export function getJackClawTools(nodeId: string): OpenClawTool[] {
  return [
    buildMentionTool(nodeId),
    buildSendTaskTool(nodeId),
    buildCheckTrustTool(nodeId),
    buildMySessionsTool(nodeId),
    buildMyCustomTool(nodeId),  // ← 添加这里
  ]
}
```

---

*文档最后更新：2026-04-03*
