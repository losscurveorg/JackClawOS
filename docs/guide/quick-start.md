# 快速开始

## 安装方式

### 方式一：全局 CLI（推荐）

```bash
npm install -g jackclaw
jackclaw demo
```

### 方式二：克隆仓库

```bash
git clone https://github.com/jackclaw/jackclaw.git
cd jackclaw
npm install
npm run build
npm run dev
```

### 方式三：OpenClaw 插件

如果你已有 Claude Code 环境，可以直接安装 OpenClaw 插件：

```bash
claude plugins install openclaw
```

插件安装后，JackClaw 的 Hub 能力将直接集成到你的 Claude Code 会话中。

---

## `jackclaw demo` 使用说明

`demo` 命令会自动启动一个完整的本地演示环境：

```
jackclaw demo [--hub-port 3000] [--nodes 2] [--no-open]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--hub-port` | `3000` | Hub 监听端口 |
| `--nodes` | `2` | 自动启动的 Node 数量 |
| `--no-open` | — | 不自动打开浏览器 |

启动成功后：
- **Dashboard**: `http://localhost:3000` — 任务看板 & 日志
- **Hub API**: `http://localhost:3000/api` — REST 接口
- **WebSocket**: `ws://localhost:3000/ws` — 实时事件流

按 `Ctrl+C` 停止所有进程。

---

## 基础配置

在项目根目录创建 `jackclaw.config.js`：

```js
export default {
  hub: {
    port: 3000,
    secret: process.env.JACKCLAW_SECRET,  // 节点认证密钥
  },
  nodes: {
    maxConcurrent: 5,     // 每个 Node 最大并发任务数
    timeout: 30_000,      // 任务超时（毫秒）
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,  // 可选，用于代理
  },
  plugins: [
    '@jackclaw/memory',       // 持久化记忆
    '@jackclaw/watchdog',     // 健康监控
  ],
}
```

### 环境变量

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com   # 或你的代理地址
JACKCLAW_SECRET=your-secret-key
```

---

## 下一步

- [了解 Hub/Node 架构](/guide/architecture) — 理解系统设计
- [API 协议参考](/api/protocol) — 接入自定义 Node
