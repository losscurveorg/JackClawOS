// ClawChat — message delivery/read receipt types

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface DeliveryReceipt {
  messageId: string
  status: MessageStatus
  nodeId: string   // the node reporting this status
  ts: number
}

export interface ReadReceipt {
  messageId: string
  readBy: string   // nodeId that read the message
  ts: number
}

export interface TypingIndicator {
  fromAgent: string
  threadId: string
  isTyping: boolean
}
