// jackclaw chat [--to <nodeId>] [--type human|task] [--hub ws://localhost:3100]
import { Command } from "commander"
import * as readline from "readline"
import WebSocket from "ws"
import crypto from "crypto"

export function registerChatCommand(program: Command) {
  program
    .command("chat")
    .description("Connect to JackClaw ClawChat")
    .option("--to <nodeId>", "Target node ID (default: broadcast)")
    .option("--type <type>", "Message type: human|task|ask", "human")
    .option("--hub <url>", "Hub WebSocket URL", "ws://localhost:3100")
    .option("--node-id <id>", "Your node ID (default: cli-user)")
    .action(async (opts) => {
      const myNodeId = opts.nodeId ?? `cli-${crypto.randomBytes(4).toString("hex")}`
      const wsUrl = `${opts.hub}/chat/ws?nodeId=${encodeURIComponent(myNodeId)}`

      console.log(`🦞 ClawChat — connecting as ${myNodeId}...`)

      const ws = new WebSocket(wsUrl)
      let msgType = opts.type as string

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })

      ws.on("open", () => {
        console.log("✅ Connected. Type /task to switch to task mode, /quit to exit.\n")
        rl.setPrompt(`[${msgType}] > `)
        rl.prompt()
      })

      ws.on("message", (raw) => {
        const data = JSON.parse(raw.toString())
        if (data.event === "message") {
          const m = data.data
          const ts = new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
          process.stdout.clearLine(0)
          process.stdout.cursorTo(0)
          console.log(`\x1b[36m[${ts}] ${m.from}:\x1b[0m ${m.content}`)
          rl.prompt()
        } else if (data.event === "ack") {
          // silent ack
        }
      })

      ws.on("error", err => { console.error("WebSocket error:", err.message); process.exit(1) })
      ws.on("close", () => { console.log("\n👋 Disconnected."); process.exit(0) })

      rl.on("line", (line) => {
        const input = line.trim()
        if (!input) { rl.prompt(); return }
        if (input === "/quit") { ws.close(); return }
        if (input === "/task") { msgType = "task"; console.log("Switched to task mode"); rl.setPrompt("[task] > "); rl.prompt(); return }
        if (input === "/human") { msgType = "human"; console.log("Switched to human mode"); rl.setPrompt("[human] > "); rl.prompt(); return }
        if (input === "/ask") { msgType = "ask"; console.log("Switched to ask mode"); rl.setPrompt("[ask] > "); rl.prompt(); return }

        const msg = {
          id: crypto.randomUUID(),
          from: myNodeId,
          to: opts.to ?? "broadcast",
          content: input,
          type: msgType,
          createdAt: Date.now(),
        }
        ws.send(JSON.stringify(msg))
        rl.prompt()
      })

      rl.on("close", () => ws.close())
    })
}
