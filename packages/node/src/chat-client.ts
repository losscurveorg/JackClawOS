/**
 * NodeChatClient — Node 侧主动连接 Hub ClawChat WebSocket
 * Node 启动后自动连接，接收消息并路由到任务处理器
 */
import WebSocket from "ws"
import type { JackClawConfig } from "./config"

export type ChatMessageHandler = (msg: {
  id: string; from: string; to: string; content: string; type: string
}) => void

export class NodeChatClient {
  private ws: WebSocket | null = null
  private reconnectCount = 0
  private handlers: ChatMessageHandler[] = []
  private stopped = false

  constructor(
    private nodeId: string,
    private hubUrl: string,
  ) {}

  onMessage(handler: ChatMessageHandler) { this.handlers.push(handler) }

  connect() {
    if (this.stopped) return
    const wsUrl = this.hubUrl.replace(/^http/, "ws") + `/chat/ws?nodeId=${encodeURIComponent(this.nodeId)}`
    console.log(`[chat-client] Connecting to ${wsUrl}`)

    this.ws = new WebSocket(wsUrl)

    this.ws.on("open", () => {
      console.log("[chat-client] Connected to Hub ClawChat")
      this.reconnectCount = 0
    })

    this.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.event === "message") {
          this.handlers.forEach(h => h(data.data))
        }
      } catch {}
    })

    this.ws.on("close", () => {
      if (this.stopped) return
      const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectCount++))
      console.log(`[chat-client] Disconnected, reconnecting in ${delay}ms`)
      setTimeout(() => this.connect(), delay)
    })

    this.ws.on("error", err => {
      console.warn("[chat-client] WS error:", err.message)
    })
  }

  send(to: string, content: string, type = "human") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[chat-client] Not connected, message queued (not implemented yet)")
      return
    }
    this.ws.send(JSON.stringify({
      id: crypto.randomUUID(),
      from: this.nodeId,
      to,
      content,
      type,
      createdAt: Date.now(),
    }))
  }

  stop() {
    this.stopped = true
    this.ws?.close()
  }
}
