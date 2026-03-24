import { useEffect, useRef, useCallback } from 'react';
import useStore from '../store';

interface UseWebSocketOptions {
  onMessage: (msg: Record<string, unknown>) => void;
  onOpen: () => void;
}

interface UseWebSocketReturn {
  sendRef: React.MutableRefObject<(msg: Record<string, unknown>) => void>;
}

export function useWebSocket({ onMessage, onOpen }: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  const sendRef = useRef((msg: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.CLOSING) {
      wsRef.current.onclose = () => {
        wsRef.current = null;
        connect();
      };
      return;
    }

    useStore.getState().setWsStatus('connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectDelayRef.current = 1000;
      useStore.getState().setWsStatus('connected');
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        onMessageRef.current?.(msg);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      const delay = reconnectDelayRef.current;
      useStore.getState().setWsStatus('disconnected');
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 2, 30_000);
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will handle the reconnect
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { sendRef };
}
