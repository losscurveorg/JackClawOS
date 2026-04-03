# Changelog

## [0.2.0] — 2026-04-03

### Added
- **ClawChat** — Agent 网络原生 IM，替代外部 IM 工具
  - `type: human` 人↔人通信，Agent 路由不参与执行
  - `type: task` 直接进入 AutoRetry 执行链，零转述
  - `type: ask` 暂停等主人确认后执行
  - WebSocket 实时推送 + 离线消息队列
- **OwnerMemory** — Agent 主人记忆区（独立于工作记忆）
  - 从日常对话中静默提取：活跃时段/回复速度/消息风格/情绪状态
  - `getEmotionSnapshot()` — 供未来情感模块直接调用
  - `emotional-state` 条目有 TTL，自动过期
- **OwnerMemory 授权区** — 情绪数据用户主权框架
  - 数据本地存储，永不上传
  - 第三方产品（硬件/App/AI服务）通过授权申请访问
  - 授权粒度：AccessScope 级别（`personality:read`/`preference:read` 等）
  - `private-note` 永远不可授权，审计日志全程记录
- **TaskPlanner** — 任务规划引擎（收到任何开发任务自动输出执行计划）
  - 预计耗时（串行/并行）
  - Token 消耗估算 + 费用预估
  - 是否需要并行 + 建议 Agent 数量
  - 子任务拆分 + 依赖关系拓扑排序
  - 风险自动检测
  - AI 细化（30s 超时，超时回退启发式结果）
- **SmartCache** — Prompt 缓存探测 + Token 压缩引擎
  - 自动探测中转站是否支持 Anthropic 缓存（road2all.com 不支持）
  - 本地 token 压缩：L1重复剪枝 / L2语义摘要 / L3跨对话记忆注入
  - 探测结果缓存24小时
- **AutoRetry** — AI 软失败自动重试
  - 失败分类：hard-policy/hard-capability（不重试）/ soft-context/incomplete/uncertainty（重试）
  - 最多3轮，每轮重写 prompt，关闭退路
  - 调用方零感知（接口不变）
- **HarnessRegistry** (`@jackclaw/harness`) — ACP Harness 最佳实践层
  - 自动探测可用工具：claude-code > codex > opencode
  - `spawnBest()` 自动选择最优 Harness 执行任务
  - Memory 注入 + 写回 + 审计全程
  - `requireHumanApproval` — 完成后推 ClawChat 等主人确认
- **Hub 新路由**
  - `POST /api/plan/estimate` — 任务规划估算
  - `POST /api/chat/send` — ClawChat 发消息
  - `GET  /api/chat/threads` — 会话列表
  - `GET  /api/chat/inbox` — 离线消息收件箱
  - `GET  /api/chat/thread/:id` — 单个会话消息
  - `WS   /chat/ws` — ClawChat WebSocket

### Changed
- `handleTask()` 现在所有 harness/ai 任务自动触发 TaskPlanner，打印执行计划
- `RegisteredNode` 新增可选 `callbackUrl` 字段（Node 注册时传入，用于 Hub→Node 任务转发）
- Node 启动时运行时注入 HarnessRunner（接口注入，无编译期跨包依赖）

## [0.1.0] — 2026-04-03 (MVP)

### Added
- `@jackclaw/protocol` — RSA-2048 + AES-256-GCM E2E 加密 + 消息签名
- `@jackclaw/node` — Agent 节点 HTTP server + cron 日报
- `@jackclaw/hub` — 中央协调器（注册/任务/日报/节点列表/摘要）
- `@jackclaw/cli` — 7个 CLI 命令（init/status/nodes/report/invite/identity/config）
- `@jackclaw/memory` — 分布式记忆（L1缓存/语义检索/多节点同步/协作编辑）
- `@jackclaw/watchdog` — 沙箱隔离/进程监控/异常熔断
- `@jackclaw/payment-vault` — 资金隔离/合规引擎/审计日志
- `@jackclaw/tunnel` — Cloudflare + 自建隧道
- `create-jackclaw` — 项目脚手架
- `@jackclaw/jackclaw-sdk` — 对外 SDK
- `@jackclaw/openclaw-plugin` — OpenClaw 接入桥/AgentTool/心跳钩子
- @handle 身份寻址系统（`@alice`/`@alice.myorg`）
- TrustGraph（信任积累，不可算法生成）
- TaskBundle + HumanInLoop（L0-L3 自主度）
