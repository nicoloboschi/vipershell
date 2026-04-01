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
    // Start UI — either already running via daemon --ui flag, or spawned separately as fallback
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

  private _daemonHasUiFlag = false;

  private _startDaemon(cfg: MemoryConfig): void {
    logger.info('Starting Hindsight daemon via uvx hindsight-embed\u2026');
    // Try with --ui flag first; if it fails (exit code != 0), retry without
    const baseArgs = ['hindsight-embed@latest', '-p', PROFILE, 'daemon', 'start'];
    const uiArgs = [...baseArgs, '--ui', '--ui-port', String(cfg.uiPort), '--ui-hostname', '0.0.0.0'];

    const tryStart = (args: string[], withUi: boolean) => {
      const child = spawn('uvx', args, {
        stdio: 'ignore',
        detached: false,
        env: { ...process.env, HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT: '0' },
      });
      child.on('error', (e) => logger.warn(`Failed to launch hindsight-embed: ${e.message}`));
      child.on('exit', (code) => {
        if (code === 0 || code === null) {
          this._daemonHasUiFlag = withUi;
          return;
        }
        if (withUi) {
          // --ui flag not supported — retry without it
          logger.debug('hindsight-embed does not support --ui flag, retrying without');
          tryStart(baseArgs, false);
        } else {
          logger.warn(`hindsight-embed daemon start exited with code ${code}`);
        }
      });
    };
    tryStart(uiArgs, true);
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
      // Also ensure the control-plane UI stays alive
      if (this.client && !(await this._isUiHealthy(cfg.uiPort))) {
        logger.warn('Hindsight control-plane UI unreachable \u2014 restarting\u2026');
        this.startUi().catch(() => {});
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private _stopKeepalive(): void {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
  }

  // ── Control-plane UI ────────────────────────────────────────────────────────
  // The embedded daemon manages the UI lifecycle (--ui flag).
  // For external mode, we still need to spawn the control plane separately.

  async startUi(): Promise<string | null> {
    if (!this.client) return null;
    const cfg = this.getConfig();
    const uiUrl = `http://127.0.0.1:${cfg.uiPort}`;

    // Already reachable — nothing to do
    if (await this._isUiHealthy(cfg.uiPort)) return uiUrl;

    if (this._mode === 'external' || !this._daemonHasUiFlag) {
      // Spawn the control plane separately when:
      // - External mode (daemon is managed externally)
      // - Embedded daemon doesn't support --ui flag (older hindsight-embed)
      this._stopUi();
      this.uiProcess = spawn('npx', [
        '@vectorize-io/hindsight-control-plane',
        '--api-url', this._resolvedUrl,
        '--port', String(cfg.uiPort),
        '--hostname', '0.0.0.0',
      ], { stdio: 'ignore' });
      this.uiProcess.on('error', (e) => logger.warn(`Hindsight UI error: ${e.message}`));
      logger.info(`Hindsight control-plane UI spawned at ${uiUrl}`);
    }
    return uiUrl;
  }

  private async _isUiHealthy(port: number): Promise<boolean> {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      return resp.ok;
    } catch {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
        return resp.ok;
      } catch { return false; }
    }
  }

  private _stopUi(): void {
    if (this.uiProcess) {
      try { this.uiProcess.kill(); } catch { /* ignore */ }
      this.uiProcess = null;
    }
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
