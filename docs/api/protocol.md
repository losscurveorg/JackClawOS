# 协议规范

`@jackclaw/protocol` 是整个系统的类型源——Hub、Node、SDK 均依赖此包定义的消息格式和工具函数。

## createMessage

构建并签名一条 `JackClawMessage`，payload 用接收方公钥加密。

```ts
import { createMessage } from '@jackclaw/protocol'

const msg = createMessage(
  'node-a',           // from: 发送方 Node ID
  'node-b',           // to: 接收方 Node ID
  'task.assign',      // type: 消息类型
  { action: 'search', query: 'AI trends' },  // payloadObject: 任意对象
  recipientPublicKey, // 接收方 RSA 公钥 PEM
  senderPrivateKey,   // 发送方 RSA 私钥 PEM（用于签名）
)
```

返回 `JackClawMessage`：

```ts
interface JackClawMessage {
  from:      string   // 发送方 ID
  to:        string   // 接收方 ID
  type:      string   // 消息类型
  payload:   string   // JSON 序列化的加密载荷
  timestamp: number   // Unix 毫秒时间戳
  signature: string   // RSA-SHA256 签名（Base64）
}
```

---

## openMessage

验签并解密一条 `JackClawMessage`，还原出原始 payload 对象。

```ts
import { openMessage } from '@jackclaw/protocol'

const payload = openMessage<{ action: string; query: string }>(
  msg,                // 收到的 JackClawMessage
  senderPublicKey,    // 发送方公钥（用于验证签名）
  recipientPrivateKey // 接收方私钥（用于解密）
)

console.log(payload.action) // 'search'
```

验签失败时抛出 `Error: JackClaw: message signature verification failed`。

---

## TaskBundle

任务束——JackClaw 的任务调度单元，基于"强束/弱束"理论（来自 _Messy Jobs_ 第3章）。

### 核心类型

```ts
interface TaskBundle {
  bundleId:              string          // UUID
  strength:              'weak' | 'strong'
  tasks:                 BundledTask[]
  dependencies:          TaskDependency[]
  sharedContext?:        string          // 强束共享上下文
  responsibleNodeId:     string          // 责任归属节点
  canParallelize:        boolean         // 弱束可并行
  humanApprovalRequired: boolean         // 强束默认 true
  autonomyLevel:         0 | 1 | 2 | 3  // L0-L3 自主度等级
  createdAt:             number
}

interface BundledTask {
  taskId:      string
  action:      string
  params:      Record<string, unknown>
  dependsOn?:  string[]   // 依赖的 taskId 列表
  deadline?:   number     // 截止时间（Unix ms）
  verifiable:  boolean    // 输出是否可被外部验证
}
```

### createBundle

```ts
import { createBundle } from '@jackclaw/protocol'

const bundle = createBundle(
  [
    { taskId: 't1', action: 'research', params: { topic: 'AI' }, verifiable: true },
    { taskId: 't2', action: 'summarize', params: {}, dependsOn: ['t1'], verifiable: true },
  ],
  {
    responsibleNodeId: 'node-ceo',
    sharedContext: '用户要求：500字以内',  // 非空 context → 自动判定为强束
  }
)

console.log(bundle.strength)              // 'strong'
console.log(bundle.humanApprovalRequired) // true
```

### analyzeBundleStrength

自动推断强束/弱束的规则：

| 条件 | 结果 |
|------|------|
| `sharedContext` 非空且任务数 > 1 | 强束 |
| 存在循环依赖 | 强束 |
| 只有 `sequential` 依赖链 | 弱束 |
| 无任何依赖 | 弱束 |

### splitWeakBundle

将弱束按拓扑顺序分层，同层任务可并行：

```ts
import { splitWeakBundle } from '@jackclaw/protocol'

const layers = splitWeakBundle(weakBundle)
// layers[0] → 第一批可并行的任务
// layers[1] → 依赖第一批完成后才能运行的任务

for (const layer of layers) {
  await Promise.all(layer.map(task => runTask(task)))
}
```

强束调用此函数会抛出错误。

---

## HumanInLoop

当 AI 无法自主决策时（利益冲突、高风险操作、信任度不足），触发真人介入。

### HumanInLoopManager

```ts
import { HumanInLoopManager } from '@jackclaw/protocol'

const hil = new HumanInLoopManager({
  humanTokenSecret: process.env.HUMAN_TOKEN_SECRET,
  nodeAutonomyLevels: {
    'node-ceo': 2,    // L2：读写，不含高风险操作
    'node-worker': 1, // L1：只读
  },
})
```

### requestReview

暂停操作并等待真人审批：

```ts
const requestId = await hil.requestReview({
  trigger: 'high_stakes',
  nodeId: 'node-ceo',
  description: '即将向 1000 名用户发送邮件',
  context: { recipientCount: 1000, template: 'promo-v3' },
  options: [
    { id: 'approve', label: '确认发送', consequence: '邮件立即发出', risk: 'high' },
    { id: 'reject',  label: '取消',     consequence: '操作终止',     risk: 'low' },
  ],
  defaultOnTimeout: 'reject',
  deadline: Date.now() + 30 * 60 * 1000, // 30 分钟内未响应则自动拒绝
})
```

### resolve

真人通过 human-token 提交决策：

```ts
const token = hil.generateHumanToken(requestId)  // 管理员颁发
await hil.resolve(requestId, 'approve', token)
```

### shouldRequireHuman

在执行操作前检查是否需要人工审批：

```ts
const needsHuman = await hil.shouldRequireHuman(
  'delete-file',    // 操作名称
  'node-worker',    // 执行节点
  'node-ceo'        // 目标节点（可选，用于信任度检查）
)

if (needsHuman) {
  const reqId = await hil.requestReview({ ... })
  // 等待决策...
}
```

### 自主度等级（L0–L3）

| 等级 | 允许操作 | 适用场景 |
|------|---------|---------|
| L0 | 无（所有操作需人工）| 高安全环境 |
| L1 | 只读（read/list/query）| 监控节点 |
| L2 | 读写（不含高风险）| 通用工作节点（默认）|
| L3 | 全部，含高风险 | 完全自主（需明确授权）|

高风险操作包括：`delete`、`publish`、`deploy`、`payment`、`transfer`、`release` 等。
