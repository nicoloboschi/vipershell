import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ChildProcess } from 'child_process';
import { logger } from './server.js';

const execAsync = promisify(exec);

const BANK_ID = 'vipershell';
const PROFILE = 'vipershell';
const LOG_PATH = join(homedir(), '.hindsight', 'profiles', `${PROFILE}.log`);
const DEFAULT_EMBEDDED_URL = 'http://127.0.0.1:9027';
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15_000;
const CONFIG_PATH = join(homedir(), '.config', 'vipershell', 'config.json');

export type HindsightMode = 'embedded' | 'external';

export interface MemoryConfig {
  hindsightEnabled: boolean;
  hindsightMode: HindsightMode;
  hindsightApiUrl: string;
  hindsightApiToken: string;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  retainChunkChars: number;
  observationsEnabled: boolean;
  uiPort: number;
}

const CONFIG_DEFAULTS: MemoryConfig = {
  hindsightEnabled: true,
  hindsightMode: 'embedded',
  hindsightApiUrl: '',
  hindsightApiToken: '',
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

  get logPath(): string { return LOG_PATH; }
  private _resolvedUrl: string = DEFAULT_EMBEDDED_URL;
  private _mode: HindsightMode = 'embedded';

  get active(): boolean { return this.client !== null; }
  get apiUrl(): string { return this._resolvedUrl; }
  get mode(): HindsightMode { return this._mode; }
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
        hindsightMode: data.hindsightMode ?? CONFIG_DEFAULTS.hindsightMode,
        hindsightApiUrl: data.hindsightApiUrl ?? CONFIG_DEFAULTS.hindsightApiUrl,
        hindsightApiToken: data.hindsightApiToken ?? CONFIG_DEFAULTS.hindsightApiToken,
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
    if ('hindsightMode' in updates) data.hindsightMode = updates.hindsightMode;
    if ('hindsightApiUrl' in updates) data.hindsightApiUrl = updates.hindsightApiUrl;
    if ('hindsightApiToken' in updates) data.hindsightApiToken = updates.hindsightApiToken;
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

  /** Start Hindsight in the background. Does not block the caller. */
  startInBackground(): void {
    this.start().catch((e) => {
      logger.error(`Hindsight background start failed: ${e}`);
    });
  }

  async start(): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.hindsightEnabled) return;
    this._mode = cfg.hindsightMode;

    let HindsightClient: new (opts: { baseUrl: string; apiKey?: string }) => unknown;
    try {
      const mod = await import('@vectorize-io/hindsight-client');
      HindsightClient = mod.HindsightClient;
    } catch {
      logger.warn('Hindsight client not installed — memory disabled. Run: npm install @vectorize-io/hindsight-client');
      return;
    }

    if (cfg.hindsightMode === 'external') {
      await this._startExternal(cfg, HindsightClient);
    } else {
      await this._startEmbedded(cfg, HindsightClient);
    }
  }

  private async _startExternal(
    cfg: MemoryConfig,
    HindsightClient: new (opts: { baseUrl: string; apiKey?: string }) => unknown,
  ): Promise<void> {
    const url = cfg.hindsightApiUrl;
    if (!url) {
      logger.warn('Hindsight external mode requires an API URL — memory disabled');
      return;
    }

    this._resolvedUrl = url.replace(/\/+$/, '');

    // Verify connectivity
    try {
      const resp = await fetch(`${this._resolvedUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        logger.warn(`Hindsight external API health check failed (${resp.status}) — memory disabled`);
        return;
      }
    } catch (e) {
      logger.warn(`Hindsight external API unreachable at ${this._resolvedUrl} — memory disabled: ${e}`);
      return;
    }

    const clientOpts: { baseUrl: string; apiKey?: string } = { baseUrl: this._resolvedUrl };
    if (cfg.hindsightApiToken) clientOpts.apiKey = cfg.hindsightApiToken;
    this.client = new HindsightClient(clientOpts);
    this._startedAt = Date.now();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).createBank(BANK_ID, {
        name: 'vipershell',
        mission: 'Track terminal session activity and content for context recall.',
      });
    } catch { /* bank already exists */ }

    logger.info(`Hindsight memory ready (external) at ${this._resolvedUrl} (bank=${BANK_ID})`);

    // Auto-start control plane UI
    this.startUi().catch(() => {});
  }

  private async _startEmbedded(
    cfg: MemoryConfig,
    HindsightClient: new (opts: { baseUrl: string; apiKey?: string }) => unknown,
  ): Promise<void> {
    this._resolvedUrl = DEFAULT_EMBEDDED_URL;

    if (!(await this._isHealthy())) {
      this._startDaemon(cfg);
      if (!(await this._waitForHealth())) {
        logger.warn('Hindsight daemon did not become ready — memory disabled');
        return;
      }
    } else {
      logger.info('Hindsight daemon already running');
    }

    this.client = new HindsightClient({ baseUrl: this._resolvedUrl });
    this._startedAt = Date.now();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).createBank(BANK_ID, {
        name: 'vipershell',
        mission: 'Track terminal session activity and content for context recall.',
      });
    } catch { /* bank already exists */ }

    this._startKeepalive(cfg);
    logger.info(`Hindsight memory ready (embedded) at ${this._resolvedUrl} (bank=${BANK_ID}, llm=${cfg.llmProvider})`);

    // Auto-start control plane UI
    this.startUi().catch(() => {});
  }

  async restart(): Promise<void> {
    this._stopKeepalive();
    this._stopUi();
    if (this._mode === 'embedded') {
      await this._stopDaemon();
    }
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

  // ── Embedded daemon management ─────────────────────────────────────────────

  private _startDaemon(_cfg: MemoryConfig): void {
    logger.info('Starting Hindsight daemon via uvx hindsight-embed\u2026');
    const child = spawn('uvx', ['hindsight-embed@latest', '-p', PROFILE, 'daemon', 'start'], {
      stdio: 'ignore',
      detached: false,
    });
    child.on('error', (e) => logger.warn(`Failed to launch hindsight-embed: ${e.message}`));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) logger.warn(`hindsight-embed daemon start exited with code ${code}`);
    });
  }

  private async _stopDaemon(): Promise<void> {
    try {
      await execAsync(`uvx hindsight-embed@latest -p ${PROFILE} daemon stop`, { timeout: 10_000 });
      logger.info('Hindsight daemon stopped');
    } catch { /* not running or uvx unavailable */ }
  }

  private async _isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this._resolvedUrl}/health`, { signal: AbortSignal.timeout(1500) });
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
        logger.warn('Hindsight daemon unreachable \u2014 restarting\u2026');
        this._startDaemon(cfg);
        if (!(await this._waitForHealth(60_000))) {
          logger.error('Hindsight daemon could not be restarted \u2014 disabling memory');
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

    const url = apiUrl ?? this._resolvedUrl;
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

  async retain(content: string, _documentId: string, tags: string[], context: string): Promise<void> {
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
