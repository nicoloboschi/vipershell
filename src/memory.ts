import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ChildProcess } from 'child_process';
import { logger } from './server.js';

const execAsync = promisify(exec);

const BANK_ID = 'vipershell';
const DAEMON_URL = 'http://127.0.0.1:8888';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15_000;
const CONFIG_PATH = join(homedir(), '.config', 'vipershell', 'config.json');

export interface MemoryConfig {
  hindsightEnabled: boolean;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  retainChunkChars: number;
  observationsEnabled: boolean;
  uiPort: number;
}

const CONFIG_DEFAULTS: MemoryConfig = {
  hindsightEnabled: false,
  llmProvider: 'mock',
  llmApiKey: '',
  llmModel: '',
  retainChunkChars: 3000,
  observationsEnabled: false,
  uiPort: 18765,
};

export class MemoryStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | null = null;
  private uiProcess: ChildProcess | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private _startedAt: number | null = null;

  get active(): boolean { return this.client !== null; }
  get apiUrl(): string { return DAEMON_URL; }
  get startedAt(): number | null { return this._startedAt; }

  get retainChunkChars(): number {
    return this.getConfig().retainChunkChars;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  getConfig(): MemoryConfig {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);
      return {
        hindsightEnabled: data.hindsightEnabled ?? CONFIG_DEFAULTS.hindsightEnabled,
        llmProvider: data.hindsightLlmProvider ?? CONFIG_DEFAULTS.llmProvider,
        llmApiKey: data.hindsightLlmApiKey ?? CONFIG_DEFAULTS.llmApiKey,
        llmModel: data.hindsightLlmModel ?? CONFIG_DEFAULTS.llmModel,
        retainChunkChars: data.hindsightRetainChunkChars ?? CONFIG_DEFAULTS.retainChunkChars,
        observationsEnabled: data.hindsightObservationsEnabled ?? CONFIG_DEFAULTS.observationsEnabled,
        uiPort: data.hindsightUiPort ?? CONFIG_DEFAULTS.uiPort,
      };
    } catch {
      return { ...CONFIG_DEFAULTS };
    }
  }

  saveConfig(updates: Partial<MemoryConfig>): void {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { /* fresh */ }
    if ('hindsightEnabled' in updates) data.hindsightEnabled = updates.hindsightEnabled;
    if ('llmProvider' in updates) data.hindsightLlmProvider = updates.llmProvider;
    if ('llmApiKey' in updates) data.hindsightLlmApiKey = updates.llmApiKey;
    if ('llmModel' in updates) data.hindsightLlmModel = updates.llmModel;
    if ('retainChunkChars' in updates) data.hindsightRetainChunkChars = updates.retainChunkChars;
    if ('observationsEnabled' in updates) data.hindsightObservationsEnabled = updates.observationsEnabled;
    if ('uiPort' in updates) data.hindsightUiPort = updates.uiPort;
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n');
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.hindsightEnabled) return;

    let HindsightClient: new (opts: { baseUrl: string }) => unknown;
    try {
      const mod = await import('@vectorize-io/hindsight-client');
      HindsightClient = mod.HindsightClient;
    } catch {
      logger.warn('Hindsight client not installed — memory disabled. Run: npm install @vectorize-io/hindsight-client');
      return;
    }

    if (!(await this._isHealthy())) {
      await this._startDaemon(cfg);
      if (!(await this._waitForHealth())) {
        logger.warn('Hindsight daemon did not become ready — memory disabled');
        return;
      }
    } else {
      logger.info('Hindsight daemon already running');
    }

    this.client = new HindsightClient({ baseUrl: DAEMON_URL });
    this._startedAt = Date.now();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).createBank(BANK_ID, {
        name: 'vipershell',
        mission: 'Track terminal session activity and content for context recall.',
      });
    } catch { /* bank already exists */ }

    this._startKeepalive(cfg);
    logger.info(`Hindsight memory ready at ${DAEMON_URL} (bank=${BANK_ID}, llm=${cfg.llmProvider})`);
  }

  async restart(): Promise<void> {
    this._stopKeepalive();
    this._stopUi();
    await this._stopDaemon();
    this.client = null;
    this._startedAt = null;
    await this.start();
  }

  close(): void {
    this._stopKeepalive();
    this._stopUi();
    this.client = null;
    this._startedAt = null;
  }

  // ── Daemon management ───────────────────────────────────────────────────────

  private async _startDaemon(cfg: MemoryConfig): Promise<void> {
    logger.info('Starting Hindsight daemon via uvx hindsight-embed…');
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT: '0',   // keep running indefinitely
      HINDSIGHT_EMBED_LLM_PROVIDER: cfg.llmProvider,
    };
    if (cfg.llmApiKey) env.HINDSIGHT_EMBED_LLM_API_KEY = cfg.llmApiKey;
    if (cfg.llmModel) env.HINDSIGHT_EMBED_LLM_MODEL = cfg.llmModel;

    try {
      // Running a retain command triggers daemon auto-start inside hindsight-embed
      const proc = spawn('uvx', ['hindsight-embed@latest', 'memory', 'retain', BANK_ID, ' ', '--async'], {
        env,
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      proc.on('error', (e) => logger.warn(`uvx spawn error: ${e.message}`));
    } catch (e) {
      logger.warn(`Failed to spawn uvx: ${e}`);
    }
  }

  private async _stopDaemon(): Promise<void> {
    try {
      await execAsync('uvx hindsight-embed@latest daemon stop', { timeout: 10_000 });
      logger.info('Hindsight daemon stopped');
    } catch { /* not running or uvx unavailable */ }
  }

  private async _isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(1500) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async _waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this._isHealthy()) return true;
      await new Promise(r => setTimeout(r, HEALTH_POLL_MS));
    }
    return false;
  }

  private _startKeepalive(cfg: MemoryConfig): void {
    this.keepaliveTimer = setInterval(async () => {
      if (!this.client) return;
      if (!(await this._isHealthy())) {
        logger.warn('Hindsight daemon unreachable — restarting…');
        await this._startDaemon(cfg);
        if (!(await this._waitForHealth(10_000))) {
          logger.error('Hindsight daemon could not be restarted — disabling memory');
          this.client = null;
          this._startedAt = null;
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private _stopKeepalive(): void {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
  }

  // ── Control-plane UI ────────────────────────────────────────────────────────

  async startUi(apiUrl?: string): Promise<string | null> {
    if (!this.client) return null;
    const cfg = this.getConfig();
    this._stopUi();
    this._killPort(cfg.uiPort);

    const url = apiUrl ?? DAEMON_URL;
    this.uiProcess = spawn('npx', [
      '@vectorize-io/hindsight-control-plane',
      '--api-url', url,
      '--port', String(cfg.uiPort),
      '--hostname', '0.0.0.0',
    ], { stdio: 'ignore' });
    this.uiProcess.on('error', (e) => logger.warn(`Hindsight UI error: ${e.message}`));
    logger.info(`Hindsight control-plane UI started at http://127.0.0.1:${cfg.uiPort}`);
    return `http://127.0.0.1:${cfg.uiPort}`;
  }

  private _stopUi(): void {
    if (this.uiProcess) {
      try { this.uiProcess.kill(); } catch { /* ignore */ }
      this.uiProcess = null;
    }
  }

  private _killPort(port: number): void {
    exec(`lsof -ti :${port} -sTCP:LISTEN | xargs kill -15 2>/dev/null || true`).unref?.();
  }

  // ── Memory operations ───────────────────────────────────────────────────────

  async retain(content: string, documentId: string, tags: string[], context: string): Promise<void> {
    if (!this.client) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).retain(BANK_ID, content, {
        context,
        metadata: Object.fromEntries(tags.map(t => {
          const [k, ...v] = t.split(':');
          return [k, v.join(':')];
        })),
        async: true,
      });
    } catch (e) {
      logger.warn(`Hindsight retain failed: ${e}`);
    }
  }

  async recall(query: string): Promise<string[]> {
    if (!this.client) return [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (this.client as any).recall(BANK_ID, query, { budget: 'low' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (resp.results ?? []).map((r: any) => r.text as string);
    } catch {
      return [];
    }
  }
}
