import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { TmuxBridge } from './bridge.js';
import { createApiRouter } from './api.js';
import type { BridgeMessage } from './bridge.js';
import type { MemoryStore } from './memory.js';
import type { AIService } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Logger ───────────────────────────────────────────────────────────────────

export interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

export class LogBuffer {
  private buf: LogEntry[] = [];
  private subs = new Set<(e: LogEntry) => void>();
  private maxSize: number;

  constructor(maxSize = 500) { this.maxSize = maxSize; }

  log(level: string, msg: string): void {
    const entry: LogEntry = {
      ts: new Date().toISOString().slice(11, 23),
      level,
      msg,
    };
    this.buf.push(entry);
    if (this.buf.length > this.maxSize) this.buf.shift();
    this.subs.forEach(fn => { try { fn(entry); } catch { /* ignore */ } });
    // Also print to stderr
    process.stderr.write(`[${entry.ts}] ${level.padEnd(7)} ${msg}\n`);
  }

  subscribe(fn: (e: LogEntry) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  entries(): LogEntry[] { return [...this.buf]; }
}

export const logBuffer = new LogBuffer();

export const logger = {
  debug: (msg: string) => logBuffer.log('DEBUG', msg),
  info:  (msg: string) => logBuffer.log('INFO', msg),
  warn:  (msg: string) => logBuffer.log('WARNING', msg),
  error: (msg: string) => logBuffer.log('ERROR', msg),
};

// ── WebSocket client state ────────────────────────────────────────────────────

interface ClientState {
  sessionId: string | null;
  unsubOutput: (() => void) | null;
  unsubSessions: (() => void) | null;
}

// ── Session connect logic (extracted for testability) ─────────────────────

export interface ConnectDeps {
  pubsub: TmuxBridge['pubsub'];
  snapshot: (sessionId: string) => Promise<string>;
  connectSession: (sessionId: string) => Promise<boolean>;
  send: (msg: BridgeMessage | object) => void;
}

/**
 * Handles the 'connect' flow: subscribes to live output, takes a snapshot,
 * connects the PTY, and sends everything to the client in the right order.
 * Returns the unsubscribe function for the pubsub subscription.
 */
export async function handleSessionConnect(
  sessionId: string,
  deps: ConnectDeps,
): Promise<() => void> {
  // 1. Subscribe to pubsub FIRST so we never miss output during
  //    the async snapshot/connect calls below.
  const pending: string[] = [];
  let draining = false;
  const unsub = deps.pubsub.subscribe(sessionId, (m: BridgeMessage) => {
    if (m.type !== 'output') return;
    if (draining) { deps.send(m); } else { pending.push(m.data); }
  });

  // 2. Take snapshot — the authoritative screen state. Any output
  //    that arrives during this async call is safely buffered above.
  const snap = await deps.snapshot(sessionId);

  // 3. Ensure PTY is running. If newly created, tmux attach
  //    dumps the visible screen which duplicates the snapshot —
  //    discard the pending buffer in that case.
  const isNew = await deps.connectSession(sessionId);

  // 4. Send snapshot to client.
  deps.send({ type: 'connected' });
  deps.send({ type: 'output', data: snap });

  // 5. Flush buffered live output. If PTY was freshly attached,
  //    the pending data is just the initial screen dump (already
  //    covered by the snapshot) — skip it to avoid duplicates.
  if (isNew) {
    await new Promise(r => setTimeout(r, 20));
    pending.length = 0;
  }
  draining = true;
  for (const data of pending) {
    deps.send({ type: 'output', data });
  }

  return unsub;
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function createApp(bridge: TmuxBridge, memory: MemoryStore, ai: AIService) {
  const app = express();
  app.use(express.json());

  // REST API
  app.use('/api', createApiRouter(bridge, logBuffer, memory, ai));

  const server = createServer(app);

  // Static UI (production build only — in dev, Vite runs separately)
  const uiDist = join(__dirname, '..', 'ui', 'dist');
  if (existsSync(uiDist) && process.env.NODE_ENV !== 'development') {
    app.use(express.static(uiDist));
    app.get('*', (_req, res) => res.sendFile(join(uiDist, 'index.html')));
  }

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientState = { sessionId: null, unsubOutput: null, unsubSessions: null };
    logger.debug('WS client connected');

    // Subscribe to session list updates
    state.unsubSessions = bridge.pubsub.subscribe('__sessions__', (msg) => {
      if (msg.type === 'sessions' || msg.type === 'last_command' || msg.type === 'current_input' || (msg.type === 'preview' && state.sessionId !== null)) {
        send(msg);
      }
    });

    function send(msg: BridgeMessage | object): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }

      try {
        switch (msg.type) {
          case 'list_sessions': {
            const sessions = await bridge.listSessions();
            send({ type: 'sessions', sessions });
            break;
          }

          case 'connect': {
            const sessionId = msg.session_id as string;
            state.unsubOutput?.();
            state.sessionId = sessionId;
            state.unsubOutput = await handleSessionConnect(sessionId, {
              pubsub: bridge.pubsub,
              snapshot: (id) => bridge.snapshot(id),
              connectSession: (id) => bridge.connectSession(id),
              send,
            });
            break;
          }

          case 'create_session': {
            const path = msg.path as string | undefined;
            const initCommand = msg.init_command as string | undefined;
            // Send optimistic response immediately so UI can update fast
            const sessionId = await bridge.createSession(path);
            send({ type: 'session_created', session_id: sessionId, path: path || null });
            // Send initial command to the new session's tmux pane
            if (initCommand) {
              bridge.sendKeys(sessionId, initCommand);
            }
            // Then refresh full session list in background
            bridge.listSessions().then(sessions => {
              send({ type: 'sessions', sessions });
            });
            break;
          }

          case 'close_session': {
            const sessionId = msg.session_id as string;
            if (state.sessionId === sessionId) {
              state.unsubOutput?.();
              state.unsubOutput = null;
              state.sessionId = null;
            }
            await bridge.closeSession(sessionId);
            const sessions = await bridge.listSessions();
            send({ type: 'sessions', sessions });
            break;
          }

          case 'input': {
            if (state.sessionId) bridge.sendInput(state.sessionId, msg.data as string);
            break;
          }

          case 'resize': {
            if (state.sessionId) {
              bridge.resize(state.sessionId, msg.cols as number, msg.rows as number);
            }
            break;
          }

        }
      } catch (e) {
        logger.error(`WS handler error: ${e}`);
      }
    });

    ws.on('close', () => {
      state.unsubOutput?.();
      state.unsubSessions?.();
      logger.debug('WS client disconnected');
    });
  });

  return server;
}
