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
  private cachedSessions: Session[] = [];

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
    this.cachedSessions = sessions;
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
        this.inputBuffers.delete(id);
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
      if (lines.length === 0) return [];

      const parsed = lines.map(line => {
        const [id, name, activityStr, autoRenameStr] = line.split('|');
        return { id: id!, name: name!, activityStr: activityStr ?? '0', autoRenameOff: autoRenameStr === '0' };
      }).filter(s => s.id && s.name);

      // Batch tmux display-message for all sessions in one shell command
      const tmuxCmd = parsed
        .map(s => `tmux display-message -t ${sh(s.id)} -p "#{pane_current_path}|#{session_activity}|#{pane_pid}|#{pane_title}" 2>/dev/null || echo "|||"`)
        .join('; echo "---SEP---"; ');
      const { stdout: tmuxOut } = await execAsync(tmuxCmd, { timeout: 5000 });
      const tmuxChunks = tmuxOut.split('---SEP---');

      // Collect all pane PIDs for a single batched process inspection
      const paneInfos: { path: string; paneActivity: number; panePid: number; paneTitle: string }[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const info = (tmuxChunks[i] ?? '|||').trim();
        const [path, paneActivityStr, panePidStr, paneTitle] = info.split('|');
        paneInfos.push({
          path: path ?? os.homedir(),
          paneActivity: parseInt(paneActivityStr ?? '0', 10),
          panePid: parseInt(panePidStr ?? '0', 10),
          paneTitle: paneTitle ?? '',
        });
      }

      // Single batched process inspection: get all child PIDs, their commands, CPU, RSS, and grandchild counts
      const allPids = paneInfos.map(p => p.panePid).filter(p => p > 0);
      const processMap = new Map<number, { children: { pid: number; comm: string; cpu: number; rss: number; hasGrandchildren: boolean }[] }>();

      if (allPids.length > 0) {
        try {
          // One command: for each pane PID, get children with comm, cpu, rss and grandchild count
          const isLinux = os.platform() === 'linux';
          const inspectCmd = allPids.map(pid => {
            if (isLinux) {
              return `echo "PANE:${pid}"; ps -o pid=,comm=,pcpu=,rss= --ppid ${pid} 2>/dev/null || true; ` +
                `echo "GC:${pid}"; pgrep -P $(pgrep -P ${pid} 2>/dev/null | tr '\\n' ',' | sed 's/,$//') 2>/dev/null | wc -l || echo 0`;
            }
            return `echo "PANE:${pid}"; pgrep -P ${pid} 2>/dev/null | xargs -I{} ps -p {} -o pid=,comm=,pcpu=,rss= 2>/dev/null || true; ` +
              `echo "GC:${pid}"; for cpid in $(pgrep -P ${pid} 2>/dev/null); do pgrep -P $cpid 2>/dev/null; done | wc -l || echo 0`;
          }).join('; ');
          const { stdout: inspectOut } = await execAsync(inspectCmd, { timeout: 5000 });

          let currentPanePid = 0;
          let inGc = false;
          let gcCount = 0;
          const children: { pid: number; comm: string; cpu: number; rss: number }[] = [];

          for (const line of inspectOut.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const paneMatch = trimmed.match(/^PANE:(\d+)$/);
            if (paneMatch) {
              // Save previous (skip if GC handler already saved it)
              if (currentPanePid > 0 && !processMap.has(currentPanePid)) {
                processMap.set(currentPanePid, {
                  children: children.splice(0).map(c => ({ ...c, hasGrandchildren: false })),
                });
              } else {
                children.length = 0;
              }
              currentPanePid = parseInt(paneMatch[1]!, 10);
              inGc = false;
              continue;
            }

            const gcMatch = trimmed.match(/^GC:(\d+)$/);
            if (gcMatch) {
              inGc = true;
              gcCount = 0;
              continue;
            }

            if (inGc) {
              gcCount = parseInt(trimmed, 10) || 0;
              if (currentPanePid > 0) {
                const entry = processMap.get(currentPanePid) ?? { children: children.splice(0).map(c => ({ ...c, hasGrandchildren: false })) };
                // Mark all children as having grandchildren if any exist
                if (gcCount > 0) {
                  for (const c of entry.children) c.hasGrandchildren = true;
                }
                processMap.set(currentPanePid, entry);
              }
              inGc = false;
              continue;
            }

            // Child process line: pid comm cpu rss
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 4) {
              children.push({
                pid: parseInt(parts[0]!, 10),
                comm: parts[1] ?? '',
                cpu: parseFloat(parts[2] ?? '0'),
                rss: parseInt(parts[3] ?? '0', 10),
              });
            }
          }
          // Save last
          if (currentPanePid > 0 && !processMap.has(currentPanePid)) {
            processMap.set(currentPanePid, {
              children: children.splice(0).map(c => ({ ...c, hasGrandchildren: false })),
            });
          }
        } catch { /* ignore */ }
      }

      // Build session objects
      const hostname = os.hostname();
      const username = os.userInfo().username;
      const nowSec = Math.floor(Date.now() / 1000);

      const sessions: Session[] = parsed.map((s, i) => {
        const pi = paneInfos[i]!;
        const procs = processMap.get(pi.panePid);

        const recentOutput = (nowSec - pi.paneActivity) < 5;
        let busy = recentOutput;
        let isClaudeCode = false;
        let cpuPercent = 0;
        let memMb = 0;

        if (procs) {
          for (const c of procs.children) {
            if (!busy && (c.cpu > 5 || c.hasGrandchildren)) busy = true;
            if (/\bclaude\b/i.test(c.comm)) isClaudeCode = true;
            cpuPercent += c.cpu;
            memMb += c.rss / 1024;
          }
        }

        const displayName = s.autoRenameOff
          ? s.name
          : (pi.paneTitle && pi.paneTitle.trim() && pi.paneTitle.trim() !== hostname)
            ? pi.paneTitle.trim()
            : s.name;

        return {
          id: s.id,
          name: displayName,
          path: pi.path || os.homedir(),
          username,
          last_activity: parseInt(s.activityStr, 10),
          busy,
          isClaudeCode,
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memMb: Math.round(memMb),
        };
      });

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
    await execAsync(`tmux new-session -d -s ${JSON.stringify(name)} ${dirArg} && tmux set-option -t ${JSON.stringify(name)} status off`);
    const { stdout } = await execAsync(`tmux display-message -t ${JSON.stringify(name)} -p "#{session_id}" 2>/dev/null`);
    return stdout.trim() || name;
  }

  async renameSession(sessionId: string, newName: string): Promise<void> {
    await execAsync(`tmux rename-session -t ${sh(sessionId)} ${JSON.stringify(newName)}`);
  }

  /** Send a slash command to all Claude Code sessions via tmux send-keys. */
  async injectClaudeCodeCommand(command: string): Promise<string[]> {
    const sessions = await this.listSessions();
    const injected: string[] = [];
    for (const s of sessions) {
      if (!s.isClaudeCode) continue;
      try {
        // Send Escape to dismiss any menu, wait for it to be processed,
        // then send the command. Without the delay, Esc + / + r forms an escape sequence.
        await execAsync(`tmux send-keys -t ${sh(s.id)} Escape`);
        await new Promise(r => setTimeout(r, 100));
        await execAsync(`tmux send-keys -t ${sh(s.id)} ${sh(command)} Enter`);
        injected.push(s.id);
        logger.info(`Injected "${command}" into Claude Code session ${s.id} (${s.name})`);
      } catch (e) {
        logger.debug(`Failed to inject into ${s.id}: ${e}`);
      }
    }
    return injected;
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
    // Use cached sessions from last discoverSessions() — avoids re-running
    // all the heavy pgrep/ps/pstree calls every second.
    const sessions = this.cachedSessions;
    if (sessions.length === 0) return;

    // Batch all capture-pane calls into a single tmux command
    const ids = sessions.map(s => s.id);
    const busyMap = new Map(sessions.map(s => [s.id, s.busy]));
    try {
      const captureCmd = ids
        .map(id => `tmux capture-pane -p -t ${sh(id)} 2>/dev/null; echo "---VIPER_SEP---"`)
        .join('; ');
      const { stdout } = await execAsync(captureCmd, { timeout: 5000 });
      const chunks = stdout.split('---VIPER_SEP---');
      for (let i = 0; i < ids.length && i < chunks.length; i++) {
        const lines = chunks[i]!.split('\n').filter(l => l.trim());
        const preview = lines.slice(-2).join('\n');
        this.pubsub.publish('__sessions__', {
          type: 'preview',
          session_id: ids[i]!,
          preview,
          busy: busyMap.get(ids[i]!) ?? false,
        });
      }
    } catch { /* ignore */ }
  }

  diagnostics() {
    return {
      managedPtys: this.managed.size,
      scrollbackStreams: this.scrollbackStreams.size,
      memBuffers: this.memBuffers.size,
      inputBuffers: this.inputBuffers.size,
      knownSessions: this.knownSessions.size,
      pubsubChannels: this.pubsub.channelStats(),
      serverMemory: process.memoryUsage(),
    };
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
