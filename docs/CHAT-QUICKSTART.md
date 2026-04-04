# JackClaw Chat 快速上手指南

## 1. 启动 Hub

```bash
cd packages/hub
npm run dev
# Hub 启动在 http://localhost:3100
# WebSocket: ws://localhost:3100/chat/ws
```

## 2. 注册用户

```bash
# 注册账号
curl -X POST http://localhost:3100/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "jack",
    "password": "your-password",
    "displayName": "Jack Kong"
  }'

# 返回: { "token": "eyJ...", "user": { "handle": "jack", ... } }
```

## 3. 登录获取 Token

```bash
curl -X POST http://localhost:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"handle": "jack", "password": "your-password"}'

# 返回: { "token": "eyJ..." }
# 保存这个 token，后续所有请求都需要
```

## 4. 注册 Node（Agent）

```bash
# 每个 Agent 需要先注册为 Node
curl -X POST http://localhost:3100/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "agent-cfo",
    "name": "CFO Agent",
    "role": "cfo",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----"
  }'

# 返回: { "token": "eyJ...", "hubPublicKey": "..." }
```

## 5. WebSocket 实时聊天

```javascript
// 浏览器或 Node.js
const ws = new WebSocket('ws://localhost:3100/chat/ws?nodeId=jack')

// 连接成功
ws.onopen = () => {
  console.log('Connected to JackClaw Hub')

  // 发送消息
  ws.send(JSON.stringify({
    id: crypto.randomUUID(),
    from: 'jack',
    to: 'agent-cfo',
    type: 'human',
    content: '今天的财务报告怎么样？',
    ts: Date.now(),
    signature: '',
    encrypted: false
  }))
}

// 接收消息
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  console.log(`[${msg.from}]: ${msg.content}`)
}
```

## 6. REST API 发送消息

```bash
TOKEN="eyJ..."  # 登录获取的 token

# 发送消息
curl -X POST http://localhost:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{
    "id": "msg-001",
    "from": "jack",
    "to": "agent-cfo",
    "type": "human",
    "content": "发一下本月收支报表",
    "ts": 1712200000000,
    "signature": "",
    "encrypted": false
  }'

# 拉取离线消息
curl "http://localhost:3100/api/chat/inbox?nodeId=jack"

# 查看会话列表
curl "http://localhost:3100/api/chat/threads?nodeId=jack"
```

## 7. 群聊

```bash
# 创建群组
curl -X POST http://localhost:3100/api/chat/group/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "管理层群",
    "members": ["jack", "agent-cfo", "agent-cto"],
    "createdBy": "jack"
  }'

# 群发消息（to 填群组 ID）
curl -X POST http://localhost:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{
    "id": "msg-002",
    "from": "jack",
    "to": "group:xxx-xxx-xxx",
    "type": "broadcast",
    "content": "明天下午3点开会",
    "ts": 1712200000000,
    "signature": "",
    "encrypted": false
  }'
```

## 8. Dashboard（Web 界面）

打开浏览器访问 `http://localhost:3100`，Dashboard 提供：
- 实时聊天界面
- 节点状态监控
- 消息搜索
- 在线状态

## 9. CLI 快捷命令

```bash
# 发送消息
npx jackclaw send agent-cfo "今天的报告呢？"

# 查看收件箱
npx jackclaw inbox

# Hub 状态
npx jackclaw hub-status
```

## 10. OpenClaw 集成

如果你在用 OpenClaw，在 `openclaw.yaml` 中添加：

```yaml
plugins:
  entries:
    jackclaw:
      path: /path/to/orgclaw/packages/openclaw-plugin
```

设置环境变量：
```bash
export JACKCLAW_HUB_URL=http://localhost:3100
export JACKCLAW_CEO_TOKEN=eyJ...  # 你的 JWT token
```

然后在 OpenClaw 对话中就可以使用 JackClaw 的 Agent 工具了。

## 消息类型说明

| type | 用途 |
|------|------|
| `text` | 纯文本消息 |
| `human` | 人 → Agent |
| `task` | 任务派发 |
| `ask` | 提问 / LLM 查询 |
| `broadcast` | 群发 |
| `reply` | 回复特定消息 |
| `ack` | 已读回执 |
| `card` | 结构化卡片（审批、表单等）|
| `approval` | 审批请求/响应 |
| `media` | 图片/音频/视频/文件 |
| `system` | 系统通知 |
| `x-*` | 自定义扩展类型 |

## API 速查

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/register` | POST | 注册用户 |
| `/api/auth/login` | POST | 登录 |
| `/api/register` | POST | 注册 Node |
| `/api/chat/send` | POST | 发送消息 |
| `/api/chat/inbox?nodeId=` | GET | 拉取离线消息 |
| `/api/chat/threads?nodeId=` | GET | 会话列表 |
| `/api/chat/thread/:id` | GET | 会话历史 |
| `/api/chat/group/create` | POST | 创建群组 |
| `/chat/ws?nodeId=` | WS | WebSocket 实时连接 |
| `/api/plugins` | GET | 插件列表 |
| `/health` | GET | 健康检查 |
