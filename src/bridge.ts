import { exec } from 'child_process';
import { promisify } from 'util';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { PubSub } from './pubsub.js';
import { logger } from './server.js';
import type { MemoryStore } from './memory.js';
import os from 'os';

const execAsync = promisify(exec);

export interface Session {
  id: string;
  name: string;
  path: string;
  username: string;
  last_activity: number;
  busy: boolean;
}

interface ManagedSession {
  pty: IPty;
  cols: number;
  rows: number;
  lastPreview: string;
}

interface MemBuffer {
  chunks: string[];
  seq: number;
  lastText: string;
}

export type BridgeMessage =
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'output'; data: string }
  | { type: 'preview'; session_id: string; preview: string; busy: boolean };

const SHELL_COMMANDS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh']);

function isShell(cmd: string): boolean {
  return SHELL_COMMANDS.has(cmd.toLowerCase().replace(/^-/, ''));
}

export class TmuxBridge {
  private managed = new Map<string, ManagedSession>();
  private memBuffers = new Map<string, MemBuffer>();
  readonly pubsub = new PubSub<BridgeMessage>();
  private sessionListInterval: NodeJS.Timeout | null = null;
  private previewInterval: NodeJS.Timeout | null = null;
  private knownSessions = new Set<string>();
  private memory: MemoryStore | null = null;

  setMemory(memory: MemoryStore): void {
    this.memory = memory;
  }

  async start(): Promise<void> {
    // Initial discovery
    await this.discoverSessions();
    // Poll every 2s for new/closed sessions
    this.sessionListInterval = setInterval(() => this.discoverSessions().catch(() => {}), 2000);
    // Poll every 3s for previews
    this.previewInterval = setInterval(() => this.publishPreviews().catch(() => {}), 3000);
    logger.info('TmuxBridge started');
  }

  stop(): void {
    if (this.sessionListInterval) clearInterval(this.sessionListInterval);
    if (this.previewInterval) clearInterval(this.previewInterval);
    for (const [, ms] of this.managed) {
      try { ms.pty.kill(); } catch { /* ignore */ }
    }
    this.managed.clear();
    logger.info('TmuxBridge stopped');
  }

  private async discoverSessions(): Promise<void> {
    const sessions = await this.listSessions();
    const liveIds = new Set(sessions.map(s => s.id));

    // Detect removed sessions
    for (const id of this.knownSessions) {
      if (!liveIds.has(id)) {
        this.knownSessions.delete(id);
        const ms = this.managed.get(id);
        if (ms) {
          try { ms.pty.kill(); } catch { /* ignore */ }
          this.managed.delete(id);
        }
        await this._flushMemory(id, '');
        this.memBuffers.delete(id);
        logger.debug(`Session closed: ${id}`);
      }
    }

    // Detect new sessions
    for (const s of sessions) {
      if (!this.knownSessions.has(s.id)) {
        this.knownSessions.add(s.id);
        logger.debug(`Session discovered: ${s.id}`);
      }
    }

    this.pubsub.publish('__sessions__', { type: 'sessions', sessions });
  }

  async listSessions(): Promise<Session[]> {
    try {
      const { stdout } = await execAsync(
        'tmux list-sessions -F "#{session_name}|#{session_activity}" 2>/dev/null'
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      const sessions: Session[] = [];

      for (const line of lines) {
        const [name, activityStr] = line.split('|');
        if (!name) continue;
        try {
          const { stdout: info } = await execAsync(
            `tmux display-message -t ${JSON.stringify(name)} -p "#{pane_current_path}|#{pane_current_command}" 2>/dev/null`
          );
          const [path, cmd] = info.trim().split('|');
          sessions.push({
            id: name,
            name,
            path: path ?? os.homedir(),
            username: os.userInfo().username,
            last_activity: parseInt(activityStr ?? '0', 10),
            busy: !isShell(cmd ?? 'bash'),
          });
        } catch {
          sessions.push({
            id: name,
            name,
            path: os.homedir(),
            username: os.userInfo().username,
            last_activity: parseInt(activityStr ?? '0', 10),
            busy: false,
          });
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  async snapshot(sessionId: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -ep -t ${JSON.stringify(sessionId)} 2>/dev/null`
      );
      // Strip trailing blank lines so xterm doesn't scroll past the prompt
      const lines = stdout.split('\n');
      let last = lines.length - 1;
      while (last > 0 && lines[last].trim() === '') last--;
      return lines.slice(0, last + 1).join('\n') + '\n';
    } catch {
      return '';
    }
  }

  private getOrCreatePty(sessionId: string): ManagedSession {
    if (this.managed.has(sessionId)) return this.managed.get(sessionId)!;

    const cols = 220;
    const rows = 50;

    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', sessionId], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const ms: ManagedSession = { pty: ptyProcess, cols, rows, lastPreview: '' };
    this.managed.set(sessionId, ms);

    ptyProcess.onData((data) => {
      this.pubsub.publish(sessionId, { type: 'output', data });
    });

    ptyProcess.onExit(() => {
      this.managed.delete(sessionId);
      logger.debug(`PTY exited for session: ${sessionId}`);
    });

    logger.debug(`Created PTY for session: ${sessionId}`);
    return ms;
  }

  async connectSession(sessionId: string): Promise<void> {
    // Ensure PTY exists (will start streaming)
    this.getOrCreatePty(sessionId);
  }

  sendInput(sessionId: string, data: string): void {
    const ms = this.managed.get(sessionId);
    if (ms) ms.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const ms = this.managed.get(sessionId);
    if (ms) {
      ms.cols = cols;
      ms.rows = rows;
      try {
        ms.pty.resize(cols, rows);
      } catch { /* ignore */ }
    }
    // Also tell tmux to resize
    execAsync(`tmux resize-window -t ${JSON.stringify(sessionId)} -x ${cols} -y ${rows}`).catch(() => {});
  }

  async createSession(path?: string): Promise<string> {
    const name = `vs-${Date.now()}`;
    const dirArg = path ? `-c ${JSON.stringify(path)}` : `-c ${JSON.stringify(os.homedir())}`;
    await execAsync(`tmux new-session -d -s ${JSON.stringify(name)} ${dirArg}`);
    // Give tmux a moment to start
    await new Promise(r => setTimeout(r, 200));
    return name;
  }

  async closeSession(sessionId: string): Promise<void> {
    // Kill PTY if managed
    const ms = this.managed.get(sessionId);
    if (ms) {
      try { ms.pty.kill(); } catch { /* ignore */ }
      this.managed.delete(sessionId);
    }
    await execAsync(`tmux kill-session -t ${JSON.stringify(sessionId)} 2>/dev/null`);
  }

  async getSessionPid(sessionId: string): Promise<number | null> {
    try {
      const { stdout } = await execAsync(
        `tmux display-message -t ${JSON.stringify(sessionId)} -p "#{pane_pid}" 2>/dev/null`
      );
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private async publishPreviews(): Promise<void> {
    const sessions = await this.listSessions();
    for (const session of sessions) {
      try {
        const { stdout } = await execAsync(
          `tmux capture-pane -p -t ${JSON.stringify(session.id)} 2>/dev/null`
        );
        const lines = stdout.split('\n').filter(l => l.trim());
        const preview = lines.slice(-2).join('\n');
        this.pubsub.publish('__sessions__', {
          type: 'preview',
          session_id: session.id,
          preview,
          busy: session.busy,
        });
        await this._accumulateMemory(session.id, session.path, stdout.trim());
      } catch { /* ignore */ }
    }
  }

  private async _accumulateMemory(sessionId: string, path: string, text: string): Promise<void> {
    if (!this.memory?.active || !text) return;

    let buf = this.memBuffers.get(sessionId);
    if (!buf) {
      buf = { chunks: [], seq: 0, lastText: '' };
      this.memBuffers.set(sessionId, buf);
    }

    if (text === buf.lastText) return;
    buf.chunks.push(text);
    buf.lastText = text;

    const combined = buf.chunks.join('\n---\n');
    if (combined.length >= (this.memory.retainChunkChars)) {
      await this._flushMemory(sessionId, path, buf);
    }
  }

  private async _flushMemory(sessionId: string, path: string, buf?: MemBuffer): Promise<void> {
    if (!this.memory?.active) return;
    const b = buf ?? this.memBuffers.get(sessionId);
    if (!b || b.chunks.length === 0) return;

    const combined = b.chunks.join('\n---\n').trim();
    if (!combined) return;

    const tags = [
      `session:${sessionId}`,
      `path:${path}`,
      `host:${os.hostname()}`,
    ];
    const context = path
      ? `tmux terminal session in ${path}`
      : 'tmux terminal session';

    await this.memory.retain(combined, `${sessionId}-${b.seq}`, tags, context);
    b.seq++;
    b.chunks = [];
  }
}
