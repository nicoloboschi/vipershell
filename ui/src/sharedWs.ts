/**
 * Shared WebSocket singleton — one connection per browser tab.
 *
 * All components use this instead of opening individual WebSockets.
 * Output messages are routed by session_id; global messages (sessions,
 * preview, etc.) go to global subscribers.
 */

import { wsUrl } from './serverUrl';
import useStore from './store';

type MessageHandler = (msg: Record<string, unknown>) => void;

// ── Subscriber registries ────────────────────────────────────────────────────

/** Session-specific listeners (output, connected) keyed by session_id */
const sessionListeners = new Map<string, Set<MessageHandler>>();

/** Global listeners (sessions, preview, last_command, session_created, etc.) */
const globalListeners = new Set<MessageHandler>();

// ── Connection state ─────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let destroyed = false;

/** Sessions the server knows we're subscribed to (for reconnect replay) */
const activeSubscriptions = new Set<string>();

// ── Core API ─────────────────────────────────────────────────────────────────

/** Initialize the shared connection. Call once from App mount. */
export function init(): void {
  // Close any existing connection first (handles HMR re-init and StrictMode double-mount)
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  destroyed = false;
  connect();
}

/** Tear down the shared connection. Call on App unmount. */
export function destroy(): void {
  destroyed = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

/** Estimate terminal dimensions from the current viewport.
 *  Based on typical xterm.js metrics: 14px font, 1.2 line height, 8.4px cell width.
 *  Used when creating a new session so the PTY starts at the right size. */
function estimateTermDimensions(): { cols: number; rows: number } {
  // Rough cell sizes for "JetBrains Mono" at 14px / line-height 1.2
  const CELL_W = 8.4;
  const CELL_H = 17;
  // Subtract sidebar (~240px), stats bar, padding, etc.
  const availW = Math.max(window.innerWidth - 260, 400);
  const availH = Math.max(window.innerHeight - 80, 200);
  return {
    cols: Math.max(20, Math.floor(availW / CELL_W)),
    rows: Math.max(10, Math.floor(availH / CELL_H)),
  };
}

/** Send a message through the shared WebSocket. */
export function send(msg: Record<string, unknown>): void {
  // Attach terminal dimensions to create_session so the PTY starts correctly sized
  if (msg.type === 'create_session' && msg.cols == null) {
    const dims = estimateTermDimensions();
    msg = { ...msg, cols: dims.cols, rows: dims.rows };
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Subscribe to output for a specific session.
 * Also tells the server to start streaming output for this session.
 * Pass cols/rows so the server can resize before taking the snapshot.
 * Returns an unsubscribe function that also tells the server to stop.
 */
export function subscribeSession(sessionId: string, handler: MessageHandler, cols?: number, rows?: number): () => void {
  if (!sessionListeners.has(sessionId)) sessionListeners.set(sessionId, new Set());
  sessionListeners.get(sessionId)!.add(handler);

  // Tell server to subscribe (idempotent on server side)
  activeSubscriptions.add(sessionId);
  send({ type: 'subscribe', session_id: sessionId, ...(cols && rows ? { cols, rows } : {}) });

  return () => {
    const set = sessionListeners.get(sessionId);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        sessionListeners.delete(sessionId);
        // No more local listeners — tell server to unsubscribe
        activeSubscriptions.delete(sessionId);
        send({ type: 'unsubscribe', session_id: sessionId });
      }
    }
  };
}

/** Subscribe to global messages (sessions list, previews, etc.). */
export function subscribeGlobal(handler: MessageHandler): () => void {
  globalListeners.add(handler);
  return () => { globalListeners.delete(handler); };
}

// ── Internal ─────────────────────────────────────────────────────────────────

function connect(): void {
  if (destroyed) return;
  useStore.getState().setWsStatus('connecting');

  const socket = new WebSocket(wsUrl());
  ws = socket;

  socket.onopen = () => {
    if (destroyed) return;
    reconnectDelay = 1000;
    useStore.getState().setWsStatus('connected');

    // Request session list
    send({ type: 'list_sessions' });

    // Re-subscribe all active sessions (reconnect resilience)
    for (const sessionId of activeSubscriptions) {
      send({ type: 'subscribe', session_id: sessionId });
    }

    // Notify global listeners of reconnect
    for (const fn of globalListeners) {
      try { fn({ type: '__ws_open__' }); } catch { /* ignore */ }
    }
  };

  socket.onmessage = (ev: MessageEvent) => {
    if (destroyed) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(ev.data); } catch { return; }

    const type = msg.type as string;
    const sessionId = msg.session_id as string | undefined;

    // Route session-specific output to session listeners
    if (sessionId && (type === 'output' || type === 'connected')) {
      const handlers = sessionListeners.get(sessionId);
      if (handlers) {
        for (const fn of handlers) {
          try { fn(msg); } catch { /* ignore */ }
        }
      }
      return;
    }

    // Everything else goes to global listeners
    for (const fn of globalListeners) {
      try { fn(msg); } catch { /* ignore */ }
    }
  };

  socket.onclose = () => {
    if (destroyed) return;
    useStore.getState().setWsStatus('disconnected');
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  };

  socket.onerror = () => {
    // onclose will fire and handle reconnect
  };
}
