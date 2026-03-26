import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import type { WriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { PubSub } from './pubsub.js';
import { logger } from './server.js';
import type { MemoryStore } from './memory.js';
import os from 'os';

const SCROLLBACK_DIR = join(homedir(), '.config', 'vipershell', 'scrollback');
const execAsync = promisify(exec);

/**
 * Strip ANSI/terminal escape sequences from input data so they don't
 * leak into the command buffer. Handles:
 *  - CSI sequences:  ESC [ ... <letter>
 *  - OSC sequences:  ESC ] ... (ST | BEL)  where ST = ESC \
 *  - Other ESC seqs: ESC <char>
 *  - DA responses:   ESC [ ? ... c  /  ESC [ > ... c
 */
function stripEscapeSequences(data: string): string {
  return data.replace(
    /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[\x20-\x3f]*[\x40-\x7e]|.)/g,
    ''
  );
}

// Single-quote a shell argument — safe for tmux session IDs like "$3"
function sh(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface Session {
  id: string;
  name: string;
  path: string;
  username: string;
  last_activity: number;
  busy: boolean;
  isClaudeCode?: boolean;
  /** Aggregate CPU % of all child processes */
  cpuPercent?: number;
  /** Aggregate RSS memory in MB of all child processes */
  memMb?: number;
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
  | { type: 'preview'; session_id: string; preview: string; busy: boolean }
  | { type: 'last_command'; session_id: string; command: string }
  | { type: 'current_input'; session_id: string; input: string };


export class TmuxBridge {
  private managed = new Map<string, ManagedSession>();
  private scrollbackStreams = new Map<string, WriteStream>();
  private memBuffers = new Map<string, MemBuffer>();
  readonly pubsub = new PubSub<BridgeMessage>();
  private sessionListInterval: NodeJS.Timeout | null = null;
  private previewInterval: NodeJS.Timeout | null = null;
  private knownSessions = new Set<string>();
  private memory: MemoryStore | null = null;
  private inputBuffers = new Map<string, string>();

  setMemory(memory: MemoryStore): void {
    this.memory = memory;
  }

  async start(): Promise<void> {
    mkdirSync(SCROLLBACK_DIR, { recursive: true });
    // Initial discovery
    await this.discoverSessions();
    // Poll every 2s for new/closed sessions
    this.sessionListInterval = setInterval(() => this.discoverSessions().catch(() => {}), 2000);
    // Poll every 1s for previews (short enough to catch transient CPU spikes from e.g. Claude generating)
    this.previewInterval = setInterval(() => this.publishPreviews().catch(() => {}), 1000);
    logger.info('TmuxBridge started');
  }

  stop(): void {
    if (this.sessionListInterval) clearInterval(this.sessionListInterval);
    if (this.previewInterval) clearInterval(this.previewInterval);
    for (const [, ms] of this.managed) {
      try { ms.pty.kill(); } catch { /* ignore */ }
    }
    this.managed.clear();
    for (const [id] of this.scrollbackStreams) {
      this._closeScrollback(id, false);
    }
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
        this._closeScrollback(id, true);
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
        'tmux list-sessions -F "#{session_id}|#{session_name}|#{session_activity}|#{automatic-rename}" 2>/dev/null'
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      const sessions: Session[] = [];

      for (const line of lines) {
        const [id, name, activityStr, autoRenameStr] = line.split('|');
        if (!id || !name) continue;
        const autoRenameOff = autoRenameStr === '0';
        try {
          const { stdout: info } = await execAsync(
            `tmux display-message -t ${sh(id)} -p "#{pane_current_path}|#{session_activity}|#{pane_pid}|#{pane_title}" 2>/dev/null`
          );
          const [path, paneActivityStr, panePidStr, paneTitle] = info.trim().split('|');
          const paneActivity = parseInt(paneActivityStr ?? '0', 10);
          const panePid = parseInt(panePidStr ?? '0', 10);
          const nowSec = Math.floor(Date.now() / 1000);
          // Busy if: recent output, OR shell has grandchildren (tool subprocesses),
          // OR any direct child process has non-trivial CPU usage (e.g. Claude generating text)
          const recentOutput = (nowSec - paneActivity) < 5;
          let busy = recentOutput;
          if (!busy && panePid) {
            try {
              // Check grandchildren (active tool execution) and child CPU (active generation)
              const { stdout: childInfo } = await execAsync(
                `pgrep -P ${panePid} 2>/dev/null | xargs -I{} ps -p {} -o pid=,pcpu= 2>/dev/null || true`
              );
              for (const line of childInfo.trim().split('\n').filter(Boolean)) {
                const [, cpuStr] = line.trim().split(/\s+/);
                const cpu = parseFloat(cpuStr ?? '0');
                if (cpu > 5) { busy = true; break; }
                // Also check grandchildren
                const [pidStr] = line.trim().split(/\s+/);
                const { stdout: gc } = await execAsync(`pgrep -P ${pidStr} 2>/dev/null | wc -l || echo 0`);
                if (parseInt(gc.trim()) > 0) { busy = true; break; }
              }
            } catch { /* ignore */ }
          }
          // Detect Claude Code by checking child process commands
          let isClaudeCode = false;
          if (panePid) {
            try {
              const { stdout: childCmds } = await execAsync(
                `pgrep -P ${panePid} 2>/dev/null | xargs -I{} ps -p {} -o comm= 2>/dev/null || true`
              );
              isClaudeCode = childCmds.split('\n').some(c => /\bclaude\b/i.test(c.trim()));
            } catch { /* ignore */ }
          }
          // If automatic-rename is off, we (or the user) set the session name explicitly — use it.
          // Otherwise fall back to pane_title (e.g. Claude Code task description) or session name.
          const displayName = autoRenameOff
            ? name
            : (paneTitle && paneTitle.trim() && paneTitle.trim() !== os.hostname())
              ? paneTitle.trim()
              : name;
          // Collect CPU/mem for child process tree
          let cpuPercent = 0;
          let memMb = 0;
          if (panePid) {
            try {
              const isLinux = os.platform() === 'linux';
              const psCmd = isLinux
                ? `pstree -p ${panePid} 2>/dev/null | grep -oP '\\(\\K[0-9]+' | xargs -I{} ps -p {} -o pcpu=,rss= 2>/dev/null || true`
                : `pgrep -P ${panePid} 2>/dev/null | xargs -I{} ps -p {} -o pcpu=,rss= 2>/dev/null || true`;
              const { stdout: psOut } = await execAsync(psCmd, { timeout: 2000 });
              for (const line of psOut.trim().split('\n').filter(Boolean)) {
                const parts = line.trim().split(/\s+/);
                cpuPercent += parseFloat(parts[0] ?? '0') || 0;
                memMb += (parseInt(parts[1] ?? '0', 10) || 0) / 1024;
              }
            } catch { /* ignore */ }
          }

          sessions.push({
            id,
            name: displayName,
            path: path ?? os.homedir(),
            username: os.userInfo().username,
            last_activity: parseInt(activityStr ?? '0', 10),
            busy,
            isClaudeCode,
            cpuPercent: Math.round(cpuPercent * 10) / 10,
            memMb: Math.round(memMb),
          });
        } catch {
          sessions.push({
            id,
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

  getScrollbackPath(sessionId: string): string {
    return join(SCROLLBACK_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`);
  }

  async snapshot(sessionId: string): Promise<string> {
    // tmux capture-pane produces color-coded text lines (with newlines) that create
    // natural xterm scrollback. The raw log file is cursor-positioned TUI output and
    // cannot create scrollback — it's kept only for the HistoryDialog REST endpoint.
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -ep -S -2000 -t ${sh(sessionId)} 2>/dev/null`
      );
      const lines = stdout.split('\n');
      let last = lines.length - 1;
      while (last > 0 && lines[last]!.trim() === '') last--;
      // Strip trailing spaces (prevent wrapping in narrower terminals) and use
      // \r\n so xterm resets to col 0 on each line (bare \n only moves down).
      if (last >= 0) return lines.slice(0, last + 1).map(l => l.trimEnd()).join('\r\n') + '\r\n';
    } catch { /* fall through */ }
    return '';
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

    const scrollbackPath = join(SCROLLBACK_DIR, `${sessionId}.log`);
    const stream = createWriteStream(scrollbackPath, { flags: 'a' });
    this.scrollbackStreams.set(sessionId, stream);

    ptyProcess.onData((data) => {
      this.pubsub.publish(sessionId, { type: 'output', data });
      stream.write(data);
    });

    ptyProcess.onExit(() => {
      this.managed.delete(sessionId);
      this._closeScrollback(sessionId, false);
      logger.debug(`PTY exited for session: ${sessionId}`);
    });

    logger.debug(`Created PTY for session: ${sessionId}`);
    return ms;
  }

  /** Returns true if PTY was newly created (first attach). */
  async connectSession(sessionId: string): Promise<boolean> {
    const existed = this.managed.has(sessionId);
    this.getOrCreatePty(sessionId);
    return !existed;
  }

  sendInput(sessionId: string, data: string): void {
    const ms = this.managed.get(sessionId);
    if (ms) ms.pty.write(data);

    // Track last command: accumulate printable chars, flush on Enter.
    // Skip escape sequences (CSI, OSC, etc.) so terminal responses don't
    // leak into the command buffer.
    const stripped = stripEscapeSequences(data);
    for (const ch of stripped) {
      if (ch === '\r' || ch === '\n') {
        const cmd = (this.inputBuffers.get(sessionId) ?? '').trim();
        this.inputBuffers.set(sessionId, '');
        if (cmd) {
          this.pubsub.publish('__sessions__', { type: 'last_command', session_id: sessionId, command: cmd });
        }
        this.pubsub.publish('__sessions__', { type: 'current_input', session_id: sessionId, input: '' });
      } else if (ch === '\x7f' || ch === '\b') {
        // Backspace
        const cur = this.inputBuffers.get(sessionId) ?? '';
        this.inputBuffers.set(sessionId, cur.slice(0, -1));
        this.pubsub.publish('__sessions__', { type: 'current_input', session_id: sessionId, input: this.inputBuffers.get(sessionId) ?? '' });
      } else if (ch >= ' ' || ch === '\t') {
        // Printable
        this.inputBuffers.set(sessionId, (this.inputBuffers.get(sessionId) ?? '') + ch);
        this.pubsub.publish('__sessions__', { type: 'current_input', session_id: sessionId, input: this.inputBuffers.get(sessionId) ?? '' });
      }
    }
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
    execAsync(`tmux resize-window -t ${sh(sessionId)} -x ${cols} -y ${rows}`).catch(() => {});
  }

  async createSession(path?: string): Promise<string> {
    const baseName = path
      ? path.split('/').filter(Boolean).pop() ?? 'shell'
      : 'shell';

    // Pick a unique tmux session name
    let name = baseName;
    try {
      const { stdout: existing } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null');
      const taken = new Set(existing.trim().split('\n').filter(Boolean));
      let i = 2;
      while (taken.has(name)) name = `${baseName}-${i++}`;
    } catch { /* no sessions yet — any name is fine */ }

    const dirArg = path ? `-c ${JSON.stringify(path)}` : `-c ${JSON.stringify(os.homedir())}`;
    await execAsync(`tmux new-session -d -s ${JSON.stringify(name)} ${dirArg}`);
    await execAsync(`tmux set-option -t ${JSON.stringify(name)} status off`);
    // Give tmux a moment to start
    await new Promise(r => setTimeout(r, 200));
    // Return the stable $N session ID, not the name
    const { stdout } = await execAsync(`tmux display-message -t ${JSON.stringify(name)} -p "#{session_id}" 2>/dev/null`);
    return stdout.trim() || name;
  }

  async renameSession(sessionId: string, newName: string): Promise<void> {
    await execAsync(`tmux rename-session -t ${sh(sessionId)} ${JSON.stringify(newName)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    const ms = this.managed.get(sessionId);
    if (ms) {
      try { ms.pty.kill(); } catch { /* ignore */ }
      this.managed.delete(sessionId);
    }
    this._closeScrollback(sessionId, true);
    await execAsync(`tmux kill-session -t ${sh(sessionId)} 2>/dev/null`);
  }

  async getSessionPid(sessionId: string): Promise<number | null> {
    try {
      const { stdout } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_pid}" 2>/dev/null`
      );
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private _closeScrollback(sessionId: string, deleteFile: boolean): void {
    const stream = this.scrollbackStreams.get(sessionId);
    if (stream) {
      try { stream.end(); } catch { /* ignore */ }
      this.scrollbackStreams.delete(sessionId);
    }
    if (deleteFile) {
      try { unlinkSync(join(SCROLLBACK_DIR, `${sessionId}.log`)); } catch { /* ignore */ }
    }
  }

  private async publishPreviews(): Promise<void> {
    const sessions = await this.listSessions();
    for (const session of sessions) {
      try {
        const { stdout } = await execAsync(
          `tmux capture-pane -p -t ${sh(session.id)} 2>/dev/null`
        );
        const lines = stdout.split('\n').filter(l => l.trim());
        const preview = lines.slice(-2).join('\n');
        this.pubsub.publish('__sessions__', {
          type: 'preview',
          session_id: session.id,
          preview,
          busy: session.busy,
        });
        // Memory retention is handled by the Claude Code plugin, not the bridge
      } catch { /* ignore */ }
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
