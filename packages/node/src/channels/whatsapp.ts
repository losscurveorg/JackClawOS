/**
 * whatsapp.ts — WhatsApp Business Cloud API channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 18+) + built-in http module for webhook.
 * No npm dependencies required.
 *
 * Webhook verification:  GET  <webhookPath>?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * Incoming messages:     POST <webhookPath>  (WhatsApp Cloud API webhook payload)
 * Outgoing messages:     POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages
 */

import http from 'http'
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel'

const GRAPH_API = 'https://graph.facebook.com/v19.0'

export class WhatsAppChannel implements Channel {
  readonly name = 'whatsapp'

  private phoneNumberId = ''
  private accessToken   = ''
  private verifyToken   = ''
  private webhookPath   = '/webhook/whatsapp'
  private webhookPort   = 3002

  private server:          http.Server | null = null
  private messageHandler:  ((msg: IncomingMessage) => void) | null = null
  private connectedAt    = 0
  private messagesSent   = 0
  private messagesReceived = 0

  // ------------------------------------------------------------------ connect

  async connect(config: ChannelConfig): Promise<void> {
    this.phoneNumberId = config['phoneNumberId'] ?? ''
    this.accessToken   = config['accessToken']   ?? config.token ?? ''
    this.verifyToken   = config['verifyToken']   ?? ''
    this.webhookPath   = config['webhookPath']   ?? '/webhook/whatsapp'
    this.webhookPort   = config['webhookPort']   ?? 3002

    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error('WhatsAppChannel: phoneNumberId and accessToken are required')
    }

    this.server = http.createServer((req, res) => this.handleRequest(req, res))

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.webhookPort, resolve)
      this.server!.on('error', reject)
    })

    this.connectedAt = Date.now()
    console.log(`[WhatsAppChannel] Webhook listening on :${this.webhookPort}${this.webhookPath}`)
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
    }
  }

  // ------------------------------------------------------------------ webhook

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.webhookPort}`)

    if (url.pathname !== this.webhookPath) {
      res.writeHead(404).end()
      return
    }

    if (req.method === 'GET') {
      // Webhook verification handshake
      const mode      = url.searchParams.get('hub.mode')
      const token     = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')

      if (mode === 'subscribe' && token === this.verifyToken && challenge) {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(challenge)
      } else {
        res.writeHead(403).end('Forbidden')
      }
      return
    }

    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk })
      req.on('end', () => {
        try {
          this.handleWebhookPayload(JSON.parse(body))
          res.writeHead(200).end('OK')
        } catch {
          res.writeHead(400).end('Bad Request')
        }
      })
      return
    }

    res.writeHead(405).end('Method Not Allowed')
  }

  private handleWebhookPayload(payload: Record<string, unknown>): void {
    if (!this.messageHandler) return

    try {
      const entry    = (payload['entry'] as unknown[])?.[0] as Record<string, unknown>
      const change   = (entry?.['changes'] as unknown[])?.[0] as Record<string, unknown>
      const value    = change?.['value'] as Record<string, unknown>
      const messages = value?.['messages'] as Record<string, unknown>[]

      if (!messages?.length) return

      const msg      = messages[0] as Record<string, unknown>
      const contacts = (value?.['contacts'] as Record<string, unknown>[])?.[0] as Record<string, unknown>
      const profile  = contacts?.['profile'] as Record<string, unknown>

      const incoming: IncomingMessage = {
        channel:     this.name,
        senderId:    String(msg['from'] ?? ''),
        senderName:  String(profile?.['name'] ?? msg['from'] ?? ''),
        chatId:      String(msg['from'] ?? ''),
        chatType:    'direct',
        content:     this.extractText(msg),
        attachments: this.extractAttachments(msg),
        ts:          parseInt(String(msg['timestamp'] ?? '0'), 10) * 1000,
        raw:         payload,
      }

      this.messagesReceived++
      this.messageHandler(incoming)
    } catch (e) {
      console.error('[WhatsAppChannel] handleWebhookPayload error:', e)
    }
  }

  private extractText(msg: Record<string, unknown>): string {
    const textObj = msg['text'] as Record<string, unknown> | undefined
    if (textObj?.['body']) return String(textObj['body'])
    if (msg['caption'])   return String(msg['caption'])
    return ''
  }

  private extractAttachments(msg: Record<string, unknown>): IncomingMessage['attachments'] {
    const list: NonNullable<IncomingMessage['attachments']> = []

    const push = (type: string, obj: Record<string, unknown> | undefined, filenameKey?: string) => {
      if (!obj) return
      list.push({
        type,
        url:      String(obj['id'] ?? obj['link'] ?? ''),
        filename: filenameKey ? String(obj[filenameKey] ?? '') : undefined,
      })
    }

    push('image',    msg['image']    as Record<string, unknown>)
    push('document', msg['document'] as Record<string, unknown>, 'filename')
    push('audio',    msg['audio']    as Record<string, unknown>)
    push('video',    msg['video']    as Record<string, unknown>)

    return list.length ? list : undefined
  }

  // ------------------------------------------------------------------ send

  async sendMessage(to: string, content: MessageContent): Promise<void> {
    const url = `${GRAPH_API}/${this.phoneNumberId}/messages`

    let body: Record<string, unknown>

    if (content.image) {
      body = {
        messaging_product: 'whatsapp',
        to,
        type:  'image',
        image: { link: content.image, ...(content.text ? { caption: content.text } : {}) },
      }
    } else if (content.file) {
      body = {
        messaging_product: 'whatsapp',
        to,
        type:     'document',
        document: { link: content.file.url, filename: content.file.filename },
      }
    } else {
      body = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: content.text ?? content.markdown ?? '' },
      }
    }

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`WhatsApp API error ${res.status}: ${err}`)
    }

    this.messagesSent++
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  isConnected(): boolean {
    return this.server !== null && this.server.listening
  }

  getStatus(): ChannelStatus {
    return {
      connected:        this.isConnected(),
      name:             this.name,
      uptime:           this.isConnected() ? Date.now() - this.connectedAt : 0,
      messagesSent:     this.messagesSent,
      messagesReceived: this.messagesReceived,
    }
  }
}
