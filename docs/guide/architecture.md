# 架构总览

## Hub / Node / CEO 三角架构

JackClaw 的核心是一个三角协作模型：

```
         ┌─────────────┐
         │     CEO     │  ← 战略决策 & Human-in-Loop
         └──────┬──────┘
                │ 任务指令
         ┌──────▼──────┐
         │     Hub     │  ← 任务广播 & 状态聚合
         └──┬───┬───┬──┘
            │   │   │
       ┌────▼┐ ┌▼───┐ ┌▼────┐
       │Node │ │Node│ │Node │  ← 并行执行 & 工具调用
       └─────┘ └────┘ └─────┘
```

| 角色 | 职责 | 对应包 |
|------|------|--------|
| **CEO** | 接收用户目标，拆解任务，做关键决策 | `harness` |
| **Hub** | 任务注册、广播、状态管理、日志聚合 | `hub` |
| **Node** | 认领任务、调用 LLM/工具、返回结果 | `node` |

### 关键设计原则

- **Hub 无状态广播**：Hub 不保留任务逻辑，只做路由和聚合
- **Node 水平扩展**：任意数量的 Node 可动态加入/退出集群
- **CEO 人类授权**：高风险操作自动触发 Human-in-Loop 等待确认

---

## 15 个包的职责

### 核心运行时

| 包 | 说明 |
|----|------|
| `protocol` | 消息格式、TaskBundle、事件类型定义（TypeScript 类型源）|
| `hub` | HTTP + WebSocket 服务器，任务注册/广播/状态机 |
| `node` | Node 运行时，任务认领、LLM 调用、结果上报 |
| `harness` | CEO 层，任务拆解、Human-in-Loop 控制流 |

### 接入层

| 包 | 说明 |
|----|------|
| `cli` | `jackclaw` 命令行工具（demo / start / status）|
| `create-jackclaw` | 项目脚手架（`npm create jackclaw`）|
| `jackclaw-sdk` | Node.js SDK，供外部系统接入 Hub |
| `openclaw-plugin` | Claude Code 插件，零配置集成 |

### 基础设施

| 包 | 说明 |
|----|------|
| `llm-gateway` | LLM 代理层，支持多 provider、重试、限流 |
| `memory` | 持久化记忆（向量检索 + 键值存储）|
| `payment-vault` | 支付凭证隔离存储，防止 AI 直接访问 |
| `watchdog` | 健康检查、自动重启、告警推送 |
| `tunnel` | 内网穿透，将本地 Hub 暴露到公网 |

### 前端

| 包 | 说明 |
|----|------|
| `dashboard` | 任务看板 Web UI（React + WebSocket 实时更新）|
| `pwa` | PWA 移动端壳，支持离线任务推送通知 |

---

## 数据流

### 任务生命周期

```
用户输入
  │
  ▼
CEO (harness)
  ├─ 拆解为 TaskBundle[]
  ├─ 高风险任务 → Human-in-Loop 等待确认
  │
  ▼
Hub
  ├─ POST /task/register   → 任务入队
  ├─ WS broadcast          → 广播给所有 Node
  ├─ GET /task/claim       → Node 认领
  │
  ▼
Node
  ├─ 调用 llm-gateway      → LLM 推理
  ├─ 调用工具（文件/搜索/API）
  ├─ POST /task/complete   → 上报结果
  │
  ▼
Hub 聚合结果
  ├─ WebSocket push        → Dashboard 实时更新
  └─ 回调 CEO              → 下一步决策
```

### 消息格式（TaskBundle）

所有任务通过 `@jackclaw/protocol` 定义的 `TaskBundle` 格式传输，确保 Hub、Node、SDK 三方一致。详见 [协议规范](/api/protocol)。
