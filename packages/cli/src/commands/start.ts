// jackclaw start [--hub-only] [--node-only] [--hub-port 3100] [--node-port 19000]
import { Command } from "commander"
import { spawn, ChildProcess } from "child_process"
import net from "net"
import path from "path"

async function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer()
    s.once("error", () => resolve(false))
    s.once("listening", () => { s.close(); resolve(true) })
    s.listen(port)
  })
}

async function waitReady(url: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start JackClaw Hub and/or Node")
    .option("--hub-only", "Start Hub only")
    .option("--node-only", "Start Node only")
    .option("--hub-port <port>", "Hub port", "3100")
    .option("--node-port <port>", "Node port", "19000")
    .action(async (opts) => {
      const hubPort = parseInt(opts.hubPort)
      const nodePort = parseInt(opts.nodePort)
      const processes: ChildProcess[] = []

      const startHub = !opts.nodeOnly
      const startNode = !opts.hubOnly

      if (startHub) {
        if (!(await isPortFree(hubPort))) {
          console.error(`❌ Port ${hubPort} is already in use. Hub cannot start.`)
          if (!startNode) process.exit(1)
        } else {
          const hub = spawn("node", [path.resolve(__dirname, "../../hub/dist/index.js")], {
            env: { ...process.env, HUB_PORT: String(hubPort) },
            stdio: "pipe"
          })
          processes.push(hub)
          hub.stdout?.on("data", d => process.stdout.write(`\x1b[34m[hub]\x1b[0m ${d}`))
          hub.stderr?.on("data", d => process.stderr.write(`\x1b[34m[hub]\x1b[0m ${d}`))
          const ready = await waitReady(`http://localhost:${hubPort}/health`)
          console.log(ready ? `✅ Hub ready on :${hubPort}` : `⚠️ Hub may not be ready yet`)
        }
      }

      if (startNode) {
        if (!(await isPortFree(nodePort))) {
          console.error(`❌ Port ${nodePort} is already in use. Node cannot start.`)
        } else {
          const node = spawn("node", [path.resolve(__dirname, "../../node/dist/index.js")], {
            env: { ...process.env, NODE_PORT: String(nodePort) },
            stdio: "pipe"
          })
          processes.push(node)
          node.stdout?.on("data", d => process.stdout.write(`\x1b[32m[node]\x1b[0m ${d}`))
          node.stderr?.on("data", d => process.stderr.write(`\x1b[32m[node]\x1b[0m ${d}`))
          const ready = await waitReady(`http://localhost:${nodePort}/health`)
          console.log(ready ? `✅ Node ready on :${nodePort}` : `⚠️ Node may not be ready yet`)
        }
      }

      if (processes.length === 0) { console.error("Nothing to start."); process.exit(1) }

      const shutdown = () => {
        console.log("\n⏹ Shutting down...")
        processes.forEach(p => { p.kill("SIGTERM"); setTimeout(() => p.kill("SIGKILL"), 1000) })
        setTimeout(() => process.exit(0), 1500)
      }
      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
      console.log("Running. Press Ctrl+C to stop.")
    })
}
