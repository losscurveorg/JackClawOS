# @jackclaw/openclaw-plugin

JackClaw 的 OpenClaw Plugin 适配层。让 CEO 通过任意 OpenClaw 渠道（飞书、微信、Telegram 等）实时查询团队汇报和节点状态。

---

## 功能

| 触发方式 | 效果 |
|---|---|
| `/jackclaw report` | 查看今日团队汇报摘要 |
| `/jackclaw status` | 查看所有节点在线情况 |
| `/jackclaw help` | 显示帮助 |
| 发送「团队汇报」「日报」「汇报摘要」 | 自动返回汇报摘要（无需命令） |
| 发送「节点状态」「在线情况」 | 自动返回节点状态 |
| 定时推送 | Hub 有新汇报时主动通知 CEO |

所有功能在任何 OpenClaw 渠道均可使用：飞书 / 微信 / Telegram / Discord / Slack 等。

---

## 安装

### 1. 安装插件包

```bash
npm install @jackclaw/openclaw-plugin
```

或使用本地路径（monorepo 开发时）：

```bash
# 无需 npm install，直接在 openclaw.yaml 中配置本地路径
```

---

## openclaw.yaml 配置

在 `~/.openclaw/openclaw.yaml`（或 OpenClaw 配置文件）中添加：

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "https://hub.jackclaw.dev"  # 或 http://localhost:3100
        # autoRegister: true  # 默认开启，设为 false 可跳过 ClawChat 自动注册
```

### 完整配置示例（含推送通知）

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "https://hub.jackclaw.dev"
        autoRegister: true
      notifyTo: "your-feishu-open-id-or-telegram-id"
      notifyChannel: "feishu"   # 或 telegram / openclaw-weixin 等
```

### 配置参数说明

| 参数 | 位置 | 默认值 | 说明 |
|---|---|---|---|
| `config.hubUrl` | `plugins.entries.jackclaw.config` | `JACKCLAW_HUB_URL` → `http://localhost:3100` | JackClaw Hub 地址 |
| `config.autoRegister` | `plugins.entries.jackclaw.config` | `true` | 启动时自动注册 ClawChat 账号 |
| `notifyTo` | `plugins.entries.jackclaw` | — | 推送通知目标 ID |
| `notifyChannel` | `plugins.entries.jackclaw` | — | 推送通知渠道（feishu / telegram 等） |

**hubUrl 优先级**：`config.hubUrl` > `JACKCLAW_HUB_URL` 环境变量 > `http://localhost:3100`

---

## 环境变量

```bash
# Hub 地址（当 openclaw.yaml 未配置 config.hubUrl 时生效）
export JACKCLAW_HUB_URL=http://localhost:3100

# CEO JWT（用于访问 /api/nodes 和 /api/summary）
export JACKCLAW_CEO_TOKEN=your-ceo-jwt-here
```

---

## 使用方法

### 1. 配置好 openclaw.yaml 后，重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

### 2. 在任意渠道发送命令

```
/jackclaw status    → 查看节点状态
/jackclaw report    → 查看今日汇报摘要
/jackclaw help      → 帮助说明
```

或直接发送自然语言：「节点状态」「团队汇报」等。

---

## 开发

```bash
# 类型检查
npm run typecheck

# 构建
npm run build

# Watch 模式
npm run dev
```

---

## 目录结构

```
packages/openclaw-plugin/
├── package.json        # name: @jackclaw/openclaw-plugin
├── tsconfig.json
├── src/
│   ├── index.ts        # Plugin 入口，注册到 OpenClaw
│   ├── plugin.ts       # Plugin 主体，注册命令/钩子/服务
│   ├── commands.ts     # 处理用户命令 + 自然语言匹配
│   ├── bridge.ts       # 查询 JackClaw Hub REST API
│   ├── chat-bridge.ts  # ClawChat WebSocket 客户端
│   └── clawchat-auth.ts # ClawChat 注册/认证
└── README.md
```

---

## Hub API 依赖

插件通过 HTTP 调用 JackClaw Hub 的以下接口：

| 接口 | 说明 |
|---|---|
| `GET /health` | 健康检查 |
| `GET /api/nodes` | 获取所有节点列表（需 JWT） |
| `GET /api/summary` | 获取今日汇报摘要（需 JWT） |

确保 Hub 服务运行，且 `JACKCLAW_CEO_TOKEN` 有效。

---

## 工作原理

1. **命令处理**：`/jackclaw <sub>` 由 `registerCommand` 注册，OpenClaw 在消息处理前拦截。
2. **自然语言触发**：通过 `before_dispatch` hook 匹配关键词，`handled: true` 阻止 LLM 介入，直接返回查询结果。
3. **定时推送**：`registerService` 启动后台轮询（60s），新汇报到来时调用 `runtime.deliver` 推送给 CEO。
4. **ClawChat 集成**：启动时自动注册/刷新 ClawChat 账号，通过 WebSocket 接收实时消息（可通过 `autoRegister: false` 关闭）。
