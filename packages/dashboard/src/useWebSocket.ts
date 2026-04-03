// ClawChat WebSocket hook — auto-reconnect, message streaming, connection state

import { useCallback, useEffect, useRef, useState } from 'react';

const WS_BASE = 'ws://localhost:3100';
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface WsMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  nodeId?: string;
}

export interface UseWebSocketResult {
  messages: WsMessage[];
  send: (content: string) => void;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  clearMessages: () => void;
}

export function useWebSocket(nodeId: string | null): UseWebSocketResult {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  const clearMessages = useCallback(() => setMessages([]), []);

  const connect = useCallback(() => {
    const id = nodeIdRef.current;
    if (!id) return;

    // Clean up any existing socket
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnecting(true);
    setError(null);

    const ws = new WebSocket(`${WS_BASE}/chat/ws?nodeId=${encodeURIComponent(id)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      attemptsRef.current = 0;
      setError(null);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as Partial<WsMessage>;
        const msg: WsMessage = {
          id: data.id ?? crypto.randomUUID(),
          role: data.role ?? 'assistant',
          content: data.content ?? String(event.data),
          timestamp: data.timestamp ?? Date.now(),
          nodeId: data.nodeId ?? id,
        };
        setMessages(prev => [...prev, msg]);
      } catch {
        // Raw text message
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: String(event.data),
            timestamp: Date.now(),
            nodeId: id,
          },
        ]);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      wsRef.current = null;

      if (attemptsRef.current < MAX_RECONNECT_ATTEMPTS && nodeIdRef.current) {
        attemptsRef.current++;
        const delay = RECONNECT_DELAY_MS * Math.min(attemptsRef.current, 5);
        reconnectTimer.current = setTimeout(connect, delay);
      } else {
        setError('连接断开，请重试');
      }
    };

    ws.onerror = () => {
      setError('WebSocket 连接错误');
      ws.close();
    };
  }, []);

  // Reconnect when nodeId changes
  useEffect(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    attemptsRef.current = 0;

    if (nodeId) {
      connect();
    } else {
      wsRef.current?.close();
      setConnected(false);
      setConnecting(false);
    }

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [nodeId, connect]);

  const send = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('未连接，无法发送');
      return;
    }
    const msg: WsMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    // Optimistic local render
    setMessages(prev => [...prev, msg]);
    wsRef.current.send(JSON.stringify({ type: 'message', content }));
  }, []);

  return { messages, send, connected, connecting, error, clearMessages };
}
