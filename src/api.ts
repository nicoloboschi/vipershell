import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
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
                pid: parseInt(parts[0], 10),
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
    if (req.url.includes('?')) target.search = req.url.split('?')[1];

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
      started_at: memory.startedAt,
    });
  });

  router.post('/memory/restart', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const cfg = memory.getConfig();

    memory.saveConfig({
      hindsightEnabled: body.hindsightEnabled !== undefined ? Boolean(body.hindsightEnabled) : cfg.hindsightEnabled,
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

  router.post('/memory/mcp-setup', async (req, res) => {
    if (!memory.active) return res.json({ ok: false, error: 'Hindsight not running' });

    const host = req.headers.host ?? `localhost:4445`;
    const mcpUrl = `http://${host}/api/hindsight/mcp/vipershell`;
    try {
      const { stdout, stderr } = await execAsync(
        `claude mcp add --scope user --transport http hindsight ${mcpUrl}`,
        { timeout: 10_000 }
      );
      if (stderr && !stdout) return res.json({ ok: false, error: stderr.trim() });
      return res.json({ ok: true });
    } catch (e: unknown) {
      const err = e as { code?: number; stderr?: string; message?: string };
      if (err.code === 127) return res.json({ ok: false, error: "'claude' not found in PATH" });
      return res.json({ ok: false, error: err.stderr?.trim() || err.message || String(e) });
    }
  });

  router.post('/memory/ui', async (req, res) => {
    if (!memory.active) return res.json({ active: false, url: null });

    const host = req.headers.host?.split(':')[0] ?? '127.0.0.1';
    const cfg = memory.getConfig();
    const proxyUrl = `${req.protocol}://${req.headers.host}/api/hindsight`;
    const url = await memory.startUi(proxyUrl);
    if (!url) return res.json({ active: false, url: null });

    const uiUrl = `${req.protocol}://${host}:${cfg.uiPort}`;
    res.json({ active: true, url: uiUrl });
  });

  return router;
}
