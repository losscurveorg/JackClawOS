---
layout: home

hero:
  name: JackClaw
  text: 让 AI 员工像真人一样协作
  tagline: Hub/Node 分布式架构，零学习成本接入，30 秒启动你的 AI 团队
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/jackclaw/jackclaw

features:
  - icon: 🧠
    title: Hub/Node 三角架构
    details: CEO 节点统筹全局，Hub 广播任务，多个 Node 并行执行——像真实团队一样分工协作。

  - icon: ⚡
    title: 30 秒快速启动
    details: 一行命令 `npx jackclaw demo` 即可体验完整的多智能体协作流程，无需任何配置。

  - icon: 🔌
    title: 插件生态（OpenClaw）
    details: 通过 OpenClaw 插件系统扩展 AI 能力——Memory、工具链、支付网关开箱即用。

  - icon: 🌐
    title: 人类在环（Human-in-Loop）
    details: 关键决策节点自动暂停并等待人类确认，确保 AI 行为在你的掌控之中。

  - icon: 🔒
    title: 安全优先
    details: 内置审计日志、权限隔离、Payment Vault——生产级安全，无需额外配置。

  - icon: 📦
    title: 15 个精心设计的包
    details: protocol / hub / node / cli / sdk / harness / watchdog 等模块各司其职，按需组合。
---

## 30 秒快速开始

```bash
# 全局安装 CLI
npm install -g jackclaw

# 运行演示（Hub + 两个 Node 自动启动）
jackclaw demo

# 或直接用 npx，无需安装
npx jackclaw demo
```

启动后访问 `http://localhost:3000` 查看 Dashboard，你会看到 AI 员工们正在处理任务。

---

[查看完整快速开始指南 →](/guide/quick-start)
