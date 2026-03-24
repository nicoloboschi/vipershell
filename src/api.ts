import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, createReadStream, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import nodePath from 'path';
import http from 'http';
import os from 'os';
import si from 'systeminformation';
import type { TmuxBridge } from './bridge.js';
import type { LogBuffer } from './server.js';
import type { MemoryStore } from './memory.js';

const execAsync = promisify(exec);

export function createApiRouter(bridge: TmuxBridge, logBuffer: LogBuffer, memory: MemoryStore): Router {
  const router = Router();

  router.get('/version', (_req, res) => {
    res.json({ version: '0.1.0' });
  });

  router.get('/sessions', async (_req, res) => {
    try {
      const sessions = await bridge.listSessions();
      res.json(sessions);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/sessions/git-roots', async (_req, res) => {
    try {
      const sessions = await bridge.listSessions();
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const entries = await Promise.all(sessions.map(async (s) => {
        try {
          const { stdout: pathOut } = await execAsync(
            `tmux display-message -t ${sh(s.id)} -p "#{pane_current_path}" 2>/dev/null`
          );
          const cwd = pathOut.trim();
          if (!cwd) return [s.id, null];
          const { stdout } = await execAsync(`git -C ${sh(cwd)} rev-parse --git-common-dir 2>/dev/null`);
          const commonDir = stdout.trim();
          if (!commonDir) return [s.id, null];
          // --git-common-dir can be relative (e.g. ".git") for the main worktree
          const absCommonDir = commonDir.startsWith('/') ? commonDir : nodePath.join(cwd, commonDir);
          return [s.id, absCommonDir];
        } catch {
          return [s.id, null];
        }
      }));
      res.json(Object.fromEntries(entries));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const sessionId = req.query.session_id as string | undefined;

      const [cpuData, memData] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      const cpu_percent = cpuData.currentLoad ?? 0;
      const mem_used_gb = memData.used / (1024 ** 3);
      const mem_percent = (memData.used / memData.total) * 100;

      let processes: { pid: number; name: string; cpu_percent: number; mem_mb: number }[] = [];
      if (sessionId) {
        const panePid = await bridge.getSessionPid(sessionId);
        if (panePid) {
          try {
            const isLinux = os.platform() === 'linux';
            const cmd = isLinux
              ? `ps -o pid=,comm=,pcpu=,rss= --ppid ${panePid} 2>/dev/null`
              : `ps -o pid=,comm=,pcpu=,rss= -p $(pgrep -P ${panePid} 2>/dev/null | tr '\\n' ',') 2>/dev/null`;
            const { stdout } = await execAsync(cmd);
            processes = stdout.trim().split('\n').filter(Boolean).map(line => {
              const parts = line.trim().split(/\s+/);
              return {
                pid: parseInt(parts[0]!, 10),
                name: parts[1] ?? '',
                cpu_percent: parseFloat(parts[2] ?? '0'),
                mem_mb: parseInt(parts[3] ?? '0', 10) / 1024,
              };
            }).filter(p => !isNaN(p.pid));
          } catch { /* ignore */ }
        }
      }

      res.json({ cpu_percent, mem_percent, mem_used_gb, processes });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.delete('/stats/process/:pid', async (req, res) => {
    try {
      const pid = parseInt(req.params.pid, 10);
      if (isNaN(pid) || pid <= 1) return res.status(400).json({ error: 'Invalid PID' });
      process.kill(pid, 'SIGTERM');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post('/pick-directory', async (_req, res) => {
    try {
      if (os.platform() !== 'darwin') return res.json({ path: null });
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose folder with prompt "Choose a directory")' 2>/dev/null`
      );
      const path = stdout.trim().replace(/\/$/, '') || null;
      res.json({ path });
    } catch {
      res.json({ path: null });
    }
  });

  router.post('/sessions/:id/rename', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name?.trim()) return res.status(400).json({ error: 'name required' });
      await bridge.renameSession(req.params.id, name.trim());
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/git/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json(null);

      const run = (cmd: string) => execAsync(cmd, { cwd }).then(r => r.stdout.trim()).catch(() => '');

      const [branch, status, aheadBehind] = await Promise.all([
        run('git rev-parse --abbrev-ref HEAD'),
        run('git status --short'),
        run('git rev-list --left-right --count @{u}...HEAD 2>/dev/null'),
      ]);

      if (!branch || branch === 'HEAD') {
        // Detached HEAD — try short hash
        const hash = await run('git rev-parse --short HEAD');
        if (!hash) return res.json(null);
        return res.json({ branch: hash, detached: true, dirty: status.length > 0, ahead: 0, behind: 0 });
      }

      const abParts = aheadBehind.split('\t');
      res.json({
        branch,
        detached: false,
        dirty: status.length > 0,
        ahead: parseInt(abParts[1] ?? '0', 10) || 0,
        behind: parseInt(abParts[0] ?? '0', 10) || 0,
      });
    } catch {
      res.json(null);
    }
  });



  router.get('/git/:sessionId/github', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json(null);

      const run = (cmd: string) => execAsync(cmd, { cwd }).then(r => r.stdout.trim()).catch(() => '');

      const remoteUrl = await run('git remote get-url origin 2>/dev/null');
      if (!remoteUrl) return res.json(null);

      const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (!m) return res.json(null);
      const owner = m[1]!;
      const repo  = m[2]!.replace(/\.git$/, '');
      const repoUrl = `https://github.com/${owner}/${repo}`;

      const branch = await run('git rev-parse --abbrev-ref HEAD');

      let prUrl: string | null = null;
      try {
        const { stdout } = await execAsync(`gh pr view --json url --jq .url 2>/dev/null`, { cwd });
        const url = stdout.trim();
        if (url.startsWith('https://')) prUrl = url;
      } catch { /* gh not available or no PR */ }

      res.json({ repoUrl, prUrl, branch, owner, repo });
    } catch {
      res.json(null);
    }
  });

  router.get('/git/:sessionId/worktrees', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json([]);
      const { stdout: rootOut } = await execAsync(`git -C ${sh(cwd)} rev-parse --show-toplevel 2>/dev/null`);
      const gitRoot = rootOut.trim();
      if (!gitRoot) return res.json([]);
      const { stdout } = await execAsync(`git -C ${sh(gitRoot)} worktree list --porcelain 2>/dev/null`);
      // Parse porcelain output: blocks separated by blank lines
      const worktrees = stdout.trim().split(/\n\n+/).filter(Boolean).map(block => {
        const lines = block.split('\n');
        const path = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length) ?? '';
        const branch = lines.find(l => l.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? null;
        const bare = lines.some(l => l === 'bare');
        const detached = lines.some(l => l === 'detached');
        return { path, branch, bare, detached };
      });
      res.json(worktrees);
    } catch {
      res.json([]);
    }
  });

  router.post('/git/:sessionId/worktree', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.status(400).json({ error: 'No session path' });
      const { stdout: rootOut } = await execAsync(`git -C ${sh(cwd)} rev-parse --show-toplevel 2>/dev/null`);
      const gitRoot = rootOut.trim();
      if (!gitRoot) return res.status(400).json({ error: 'Not a git repository' });
      const parentDir = nodePath.dirname(gitRoot);
      const repoName = nodePath.basename(gitRoot);
      let worktreePath = '';
      for (let i = 1; i <= 20; i++) {
        const candidate = nodePath.join(parentDir, `${repoName}-wt${i}`);
        if (!existsSync(candidate)) { worktreePath = candidate; break; }
      }
      if (!worktreePath) return res.status(400).json({ error: 'Could not find available worktree path' });
      await execAsync(`git -C ${sh(gitRoot)} worktree add ${sh(worktreePath)}`);
      res.json({ path: worktreePath });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/git/:sessionId/root', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json({ root: null });
      const { stdout } = await execAsync(`git -C ${sh(cwd)} rev-parse --show-toplevel 2>/dev/null`);
      res.json({ root: stdout.trim() || null });
    } catch {
      res.json({ root: null });
    }
  });

  router.get('/git/:sessionId/diff', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { mode, base, commit } = req.query as Record<string, string>;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.type('text/plain').send('');

      const run = (cmd: string) => execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 })
        .then(r => r.stdout)
        .catch((e: any) => e.stdout ?? '');

      let diff = '';
      if (mode === 'commit' && commit) {
        diff = await run(`git diff ${sh(commit)}^..${sh(commit)}`);
      } else if (mode === 'branch') {
        const baseBranch = base || 'origin/main';
        // Try the requested base; if it doesn't exist, fall back to HEAD
        diff = await run(`git diff ${sh(baseBranch)}`);
        if (!diff) {
          // Check if base ref exists — if not, show working tree diff instead
          const refExists = await run(`git rev-parse --verify ${sh(baseBranch)} 2>/dev/null`);
          if (!refExists) diff = await run('git diff HEAD');
        }
      } else {
        // Working tree: show tracked changes (staged + unstaged)
        diff = await run('git diff HEAD');
      }

      // For non-commit modes, append untracked files as synthetic diffs
      if (mode !== 'commit') {
        const untrackedOut = await run("git ls-files --others --exclude-standard");
        const untrackedFiles = untrackedOut.trim().split('\n').filter(Boolean);
        for (const file of untrackedFiles) {
          const content = await run(`git diff --no-index /dev/null ${sh(file)}`);
          if (content) diff += '\n' + content;
        }
      }

      res.type('text/plain; charset=utf-8').send(diff);
    } catch {
      res.type('text/plain; charset=utf-8').send('');
    }
  });

  router.get('/git/:sessionId/log', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { base, limit = '60' } = req.query as Record<string, string>;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json([]);

      const baseRef = base ? `^${sh(base)}` : `^${sh('origin/main')}`;
      const { stdout } = await execAsync(
        `git -C ${sh(cwd)} log HEAD ${baseRef} --format="%H\x1f%h\x1f%s\x1f%an\x1f%ar\x1f%ad" --date=short -${limit} 2>/dev/null`
      );
      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('\x1f');
        return { hash: parts[0]!, short: parts[1]!, subject: parts[2]!, author: parts[3]!, relDate: parts[4]!, date: parts[5]! };
      });
      res.json(commits);
    } catch {
      res.json([]);
    }
  });

  router.get('/sessions/:id/scrollback', (req, res) => {
    const sessionId = req.params.id;
    const scrollbackPath = bridge.getScrollbackPath(sessionId);
    if (!existsSync(scrollbackPath)) {
      return res.status(404).type('text/plain').send('No scrollback log found for this session.');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${sessionId}.log"`);
    createReadStream(scrollbackPath).pipe(res);
  });

  router.get('/sessions/:id/history', async (req, res) => {
    const sessionId = req.params.id;
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -ep -S - -t ${JSON.stringify(sessionId)} 2>/dev/null`
      );
      const lines = stdout.split('\n');
      let last = lines.length - 1;
      while (last > 0 && lines[last]!.trim() === '') last--;
      const text = last >= 0 ? lines.slice(0, last + 1).map(l => l.trimEnd()).join('\r\n') + '\r\n' : '';
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(text);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/git/:sessionId/status', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.json({ files: {} });

      const run = (cmd: string) => execAsync(cmd, { cwd }).then(r => r.stdout.trim()).catch(() => '');
      const root = await run('git rev-parse --show-toplevel 2>/dev/null');
      if (!root) return res.json({ files: {} });

      const statusOut = await run('git status --short --porcelain 2>/dev/null');
      const files: Record<string, string> = {};
      for (const line of statusOut.split('\n')) {
        if (!line) continue;
        // Format: XY filename  or  XY old -> new (for renames)
        const x = line[0]; // index status
        const y = line[1]; // working tree status
        let filePath = line.slice(3);
        // Handle renames: "R  old -> new"
        const arrowIdx = filePath.indexOf(' -> ');
        if (arrowIdx !== -1) filePath = filePath.slice(arrowIdx + 4);
        filePath = filePath.replace(/^"(.*)"$/, '$1'); // remove quotes

        // Determine status: untracked, added, modified, deleted, renamed
        let status = 'modified';
        if (x === '?' && y === '?') status = 'untracked';
        else if (x === 'A') status = 'added';
        else if (x === 'D' || y === 'D') status = 'deleted';
        else if (x === 'R') status = 'renamed';

        // Store as absolute path
        files[root + '/' + filePath] = status;
      }
      res.json({ files, root });
    } catch {
      res.json({ files: {} });
    }
  });

  // ── Notes ───────────────────────────────────────────────────────────────────

  const NOTES_DIR = nodePath.join(os.homedir(), '.vipershell');
  const NOTES_PATH = nodePath.join(NOTES_DIR, 'notes.md');

  router.get('/notes', (_req, res) => {
    try {
      if (!existsSync(NOTES_PATH)) return res.json({ content: '' });
      res.json({ content: readFileSync(NOTES_PATH, 'utf-8') });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.put('/notes', (req, res) => {
    try {
      const { content } = req.body as { content?: string };
      if (content === undefined) return res.status(400).json({ error: 'Missing content' });
      mkdirSync(NOTES_DIR, { recursive: true });
      writeFileSync(NOTES_PATH, content, 'utf-8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Filesystem browse ────────────────────────────────────────────────────────

  const expandHome = (p: string) => p.startsWith('~/') ? nodePath.join(os.homedir(), p.slice(2)) : p === '~' ? os.homedir() : p;

  router.get('/fs/:sessionId/browse', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const subpath = expandHome((req.query.path as string | undefined) ?? '');
      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = stdout.trim();
      if (!cwd) return res.status(404).json({ error: 'Session not found' });

      const dir = subpath ? nodePath.resolve(cwd, subpath) : cwd;
      const entries = readdirSync(dir, { withFileTypes: true });
      const result = entries
        .map(e => {
          const fullPath = nodePath.join(dir, e.name);
          let size = 0;
          try { if (!e.isDirectory()) size = statSync(fullPath).size; } catch { /* ignore */ }
          return { name: e.name, isDir: e.isDirectory(), path: fullPath, size };
        })
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.json({ cwd, dir, entries: result });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/fs/:sessionId/search', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const query = (req.query.q as string | undefined ?? '').trim();
      const glob  = (req.query.glob as string | undefined ?? '').trim();
      if (!query) return res.json({ results: [] });

      const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const { stdout: pathOut } = await execAsync(
        `tmux display-message -t ${sh(sessionId)} -p "#{pane_current_path}" 2>/dev/null`
      );
      const cwd = pathOut.trim();
      if (!cwd) return res.status(404).json({ error: 'Session not found' });

      // Use grep -rni, excluding common noise directories
      const excludeDirs = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache']
        .map(d => `--exclude-dir=${sh(d)}`).join(' ');
      const globArg = glob ? `--include=${sh(glob)}` : '';
      const cmd = `grep -rni --color=never -I ${excludeDirs} ${globArg} -m 500 -- ${sh(query)} . 2>/dev/null | head -500`;
      const { stdout } = await execAsync(cmd, { cwd, timeout: 10_000 }).catch(() => ({ stdout: '' }));

      const results: { file: string; line: number; text: string }[] = [];
      for (const raw of stdout.split('\n')) {
        if (!raw) continue;
        // format: ./path/to/file:lineNum:text
        const m = raw.match(/^\.\/(.+?):(\d+):(.*)$/);
        if (m) {
          results.push({
            file: m[1]!,
            line: parseInt(m[2]!, 10),
            text: m[3]!,
          });
        }
      }
      res.json({ results, cwd });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post('/fs/upload', async (req, res) => {
    const dir = expandHome(req.query.dir as string | undefined ?? '');
    const name = req.query.name as string | undefined ?? '';
    if (!dir || !name) return res.status(400).json({ error: 'Missing dir or name' });
    const safeName = nodePath.basename(name);
    if (!safeName) return res.status(400).json({ error: 'Invalid filename' });
    const destPath = nodePath.join(dir, safeName);
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      writeFileSync(destPath, Buffer.concat(chunks));
      res.json({ ok: true, path: destPath });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post('/fs/write', (req, res) => {
    const filePath = expandHome(req.query.path as string | undefined ?? '');
    if (!filePath) return res.status(400).json({ error: 'Missing path' });
    try {
      const { content } = req.body as { content?: string };
      if (content === undefined) return res.status(400).json({ error: 'Missing content' });
      writeFileSync(filePath, content, 'utf-8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post('/fs/mkdir', (req, res) => {
    const dirPath = expandHome(req.query.path as string | undefined ?? '');
    if (!dirPath) return res.status(400).json({ error: 'Missing path' });
    try {
      mkdirSync(dirPath, { recursive: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.delete('/fs/delete', (req, res) => {
    const filePath = expandHome(req.query.path as string | undefined ?? '');
    if (!filePath) return res.status(400).json({ error: 'Missing path' });
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    try {
      rmSync(filePath, { recursive: false });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/fs/raw', (req, res) => {
    const filePath = expandHome(req.query.path as string | undefined ?? '');
    if (!filePath) return res.status(400).send('Missing path');
    if (!existsSync(filePath)) return res.status(404).send('Not found');
    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) return res.status(400).send('Path is a directory');
      if (stat.size > 2 * 1024 * 1024) return res.status(413).send('File too large (> 2 MB)');
      const ext = nodePath.extname(filePath).toLowerCase();
      const imageExts  = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp']);
      const pdfExts    = new Set(['.pdf']);
      if (imageExts.has(ext)) return res.sendFile(filePath);
      if (pdfExts.has(ext))   return res.sendFile(filePath);
      // Serve as plain text for source files
      res.type('text/plain; charset=utf-8').send(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      res.status(500).send(String(e));
    }
  });

  router.get('/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for (const entry of logBuffer.entries()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsub = logBuffer.subscribe((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.on('close', () => unsub());
  });

  // ── Hindsight reverse proxy ──────────────────────────────────────────────────

  router.all('/hindsight/*', (req, res) => {
    if (!memory.active) {
      return res.status(503).json({ error: 'Hindsight not running' });
    }
    const subpath = (req.params as Record<string, string>)[0];
    const target = new URL(`${memory.apiUrl}/${subpath}`);
    if (req.url.includes('?')) target.search = req.url.split('?')[1]!;

    const proxyHeaders = { ...req.headers };
    delete proxyHeaders['host'];
    delete proxyHeaders['content-length'];

    const proxyReq = http.request({
      hostname: target.hostname,
      port: parseInt(target.port || '80'),
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...proxyHeaders, host: target.host },
    }, (proxyRes) => {
      res.status(proxyRes.statusCode ?? 200);
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v && k.toLowerCase() !== 'content-encoding') res.setHeader(k, v as string);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${e.message}` });
    });

    req.pipe(proxyReq);
  });

  // ── Memory config & control ──────────────────────────────────────────────────

  router.get('/memory/config', (_req, res) => {
    const cfg = memory.getConfig();
    res.json({
      ...cfg,
      active: memory.active,
      mode: memory.mode,
      started_at: memory.startedAt,
    });
  });

  router.post('/memory/restart', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const cfg = memory.getConfig();

    memory.saveConfig({
      hindsightEnabled: body.hindsightEnabled !== undefined ? Boolean(body.hindsightEnabled) : cfg.hindsightEnabled,
      hindsightMode: typeof body.hindsightMode === 'string' && (body.hindsightMode === 'embedded' || body.hindsightMode === 'external') ? body.hindsightMode : cfg.hindsightMode,
      hindsightApiUrl: typeof body.hindsightApiUrl === 'string' ? body.hindsightApiUrl : cfg.hindsightApiUrl,
      hindsightApiToken: typeof body.hindsightApiToken === 'string' ? body.hindsightApiToken : cfg.hindsightApiToken,
      llmProvider: typeof body.llmProvider === 'string' ? body.llmProvider : cfg.llmProvider,
      llmApiKey: typeof body.llmApiKey === 'string' ? body.llmApiKey : cfg.llmApiKey,
      llmModel: typeof body.llmModel === 'string' ? body.llmModel : cfg.llmModel,
      retainChunkChars: typeof body.retainChunkChars === 'number' ? body.retainChunkChars : cfg.retainChunkChars,
      observationsEnabled: body.observationsEnabled !== undefined ? Boolean(body.observationsEnabled) : cfg.observationsEnabled,
    });

    // Restart in background
    memory.restart().catch((e) => {
      console.error('Hindsight restart failed:', e);
    });

    res.json({ ok: true });
  });

  router.get('/memory/claude-code-status', async (_req, res) => {
    const configPath = nodePath.join(os.homedir(), '.hindsight', 'claude-code.json');
    let configExists = false;
    let configUrl = '';
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      configExists = true;
      configUrl = data.hindsightApiUrl ?? '';
    } catch { /* no config */ }

    let pluginInstalled = false;
    let pluginEnabled = false;
    try {
      const { stdout } = await execAsync('claude plugin list 2>/dev/null', { timeout: 10_000 });
      const lines = stdout.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes('hindsight-memory@hindsight')) {
          pluginInstalled = true;
          // Check next few lines for status
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (lines[j]!.includes('enabled')) { pluginEnabled = true; break; }
          }
          break;
        }
      }
    } catch { /* claude CLI not available */ }

    res.json({
      pluginInstalled,
      pluginEnabled,
      configExists,
      configUrl,
    });
  });

  router.post('/memory/claude-code-setup', async (req, res) => {
    if (!memory.active) return res.json({ ok: false, error: 'Hindsight not running' });

    const host = req.headers.host ?? 'localhost:4445';
    const hindsightUrl = `http://${host}/api/hindsight`;

    const steps: string[] = [];
    const errors: string[] = [];

    // Step 1: Add marketplace
    try {
      await execAsync('claude plugin marketplace add vectorize-io/hindsight', { timeout: 30_000 });
      steps.push('marketplace');
    } catch (e: unknown) {
      const err = e as { code?: number; stderr?: string; message?: string };
      if (err.code === 127) return res.json({ ok: false, error: "'claude' CLI not found in PATH. Install Claude Code first." });
      // Marketplace might already be added — continue
      if (err.stderr?.includes('already') || err.stderr?.includes('exists')) {
        steps.push('marketplace');
      } else {
        errors.push(`Marketplace: ${err.stderr?.trim() || err.message || String(e)}`);
      }
    }

    // Step 2: Install plugin
    try {
      await execAsync('claude plugin install hindsight-memory', { timeout: 30_000 });
      steps.push('plugin');
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string };
      if (err.stderr?.includes('already') || err.stderr?.includes('exists')) {
        steps.push('plugin');
      } else {
        errors.push(`Plugin: ${err.stderr?.trim() || err.message || String(e)}`);
      }
    }

    // Step 3: Write config pointing to vipershell's Hindsight proxy
    try {
      const configDir = nodePath.join(os.homedir(), '.hindsight');
      const configPath = nodePath.join(configDir, 'claude-code.json');
      mkdirSync(configDir, { recursive: true });

      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* fresh */ }

      const updated = {
        ...existing,
        hindsightApiUrl: hindsightUrl,
      };
      writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
      steps.push('config');
    } catch (e) {
      errors.push(`Config: ${String(e)}`);
    }

    if (errors.length > 0) {
      return res.json({ ok: false, error: errors.join('; '), steps });
    }
    return res.json({ ok: true, steps, hindsightUrl });
  });

  router.post('/memory/ui', async (req, res) => {
    if (!memory.active) return res.json({ active: false, url: null });

    const browserHost = req.headers.host?.split(':')[0] ?? '127.0.0.1';
    const cfg = memory.getConfig();
    // Pass the daemon URL directly — control plane server-side can always reach it
    const url = await memory.startUi();
    if (!url) return res.json({ active: false, url: null });

    // Return URL using the same hostname the user is browsing with
    const uiUrl = `${req.protocol}://${browserHost}:${cfg.uiPort}`;
    res.json({ active: true, url: uiUrl });
  });

  return router;
}
