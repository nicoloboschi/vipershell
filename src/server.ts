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

// ── Server factory ────────────────────────────────────────────────────────────

export async function createApp(bridge: TmuxBridge, memory: MemoryStore) {
  const app = express();
  app.use(express.json());

  // REST API
  app.use('/api', createApiRouter(bridge, logBuffer, memory));

  // Static UI (production build)
  const uiDist = join(__dirname, '..', 'ui', 'dist');
  if (existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get('*', (_req, res) => res.sendFile(join(uiDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('<h2>Run <code>npm run build:ui</code> to build the UI, or use <code>npm run dev</code>.</h2>'));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientState = { sessionId: null, unsubOutput: null, unsubSessions: null };
    logger.debug('WS client connected');

    // Subscribe to session list updates
    state.unsubSessions = bridge.pubsub.subscribe('__sessions__', (msg) => {
      if (msg.type === 'sessions' || (msg.type === 'preview' && state.sessionId !== null)) {
        send(msg);
      }
    });

    function send(msg: BridgeMessage | object): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }

    function subscribeToSession(sessionId: string): void {
      // Unsubscribe from previous session
      state.unsubOutput?.();
      state.sessionId = sessionId;

      // Subscribe to live output
      state.unsubOutput = bridge.pubsub.subscribe(sessionId, (msg) => {
        if (msg.type === 'output') send(msg);
      });
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
            // Set session ID early so resize messages (sent by the client on
            // 'connected') are processed while the snapshot is being built.
            // We do NOT subscribe to output yet — that prevents live PTY output
            // from racing the snapshot and arriving before it.
            state.unsubOutput?.();
            state.sessionId = sessionId;
            send({ type: 'connected' });
            const snap = await bridge.snapshot(sessionId);
            send({ type: 'output', data: snap });
            // Now subscribe to live output (snapshot already sent, no race)
            subscribeToSession(sessionId);
            await bridge.connectSession(sessionId);
            break;
          }

          case 'create_session': {
            const path = msg.path as string | undefined;
            const sessionId = await bridge.createSession(path);
            // Refresh session list
            const sessions = await bridge.listSessions();
            send({ type: 'sessions', sessions });
            send({ type: 'session_created', session_id: sessionId });
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
