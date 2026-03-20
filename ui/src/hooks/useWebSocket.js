import { useEffect, useRef, useCallback } from 'react';
import useStore from '../store.js';

/**
 * Manages the WebSocket lifecycle with exponential backoff reconnection.
 * Exposes a `send` function via the returned ref.
 *
 * @param {{ onMessage: (msg: object) => void, onOpen: () => void }} callbacks
 * @returns {{ sendRef: React.MutableRefObject<(msg: object) => void> }}
 */
export function useWebSocket({ onMessage, onOpen }) {
  const wsRef = useRef(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);

  // Stable refs so callbacks don't close over stale values
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  const sendRef = useRef((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

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
        // Prevent onclose from triggering reconnect
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { sendRef };
}
