import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from './server.js';
import type { TmuxBridge } from './bridge.js';

const execAsync = promisify(exec);

/** Run a CLI command with stdin input, return stdout. */
function runWithStdin(cmd: string, args: string[], input: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        if (!stdout.trim() && stderr.trim()) {
          reject(new Error(`${cmd} returned empty stdout, stderr: ${stderr.slice(0, 300)}`));
        } else {
          resolve(stdout);
        }
      }
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}
/** Fast non-crypto hash for content change detection */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

const CONFIG_PATH = join(homedir(), '.config', 'vipershell', 'config.json');

export type AIProvider = 'claude-code' | 'codex';

export interface AIConfig {
  aiEnabled: boolean;
  aiProvider: AIProvider;
  autoNaming: boolean;
  autoNamingIntervalSecs: number;
}

const AI_DEFAULTS: AIConfig = {
  aiEnabled: false,
  aiProvider: 'claude-code',
  autoNaming: true,
  autoNamingIntervalSecs: 30,
};

export class AIService {
  private bridge: TmuxBridge | null = null;
  private namingTimer: NodeJS.Timeout | null = null;
  /** Track which sessions were recently named to avoid hammering the LLM */
  private lastNamed = new Map<string, number>();
  /** Hash of terminal content used for the last naming — skip if unchanged */
  private lastContentHash = new Map<string, string>();
  private inFlight = new Set<string>();

  getConfig(): AIConfig {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);
      return {
        aiEnabled: data.aiEnabled ?? AI_DEFAULTS.aiEnabled,
        aiProvider: data.aiProvider ?? AI_DEFAULTS.aiProvider,
        autoNaming: data.aiAutoNaming ?? AI_DEFAULTS.autoNaming,
        autoNamingIntervalSecs: data.aiAutoNamingIntervalSecs ?? AI_DEFAULTS.autoNamingIntervalSecs,
      };
    } catch {
      return { ...AI_DEFAULTS };
    }
  }

  saveConfig(updates: Partial<AIConfig>): void {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { /* fresh */ }
    if ('aiEnabled' in updates) data.aiEnabled = updates.aiEnabled;
    if ('aiProvider' in updates) data.aiProvider = updates.aiProvider;
    if ('autoNaming' in updates) data.aiAutoNaming = updates.autoNaming;
    if ('autoNamingIntervalSecs' in updates) data.aiAutoNamingIntervalSecs = updates.autoNamingIntervalSecs;
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n');
  }

  setBridge(bridge: TmuxBridge): void {
    this.bridge = bridge;
  }

  start(): void {
    this.stop();
    const cfg = this.getConfig();
    if (!cfg.aiEnabled) return;

    if (cfg.autoNaming) {
      const intervalMs = (cfg.autoNamingIntervalSecs || 30) * 1000;
      this.namingTimer = setInterval(() => this._runAutoNaming(), intervalMs);
      logger.info(`AI auto-naming started (every ${cfg.autoNamingIntervalSecs}s, provider=${cfg.aiProvider})`);
    }
  }

  stop(): void {
    if (this.namingTimer) {
      clearInterval(this.namingTimer);
      this.namingTimer = null;
    }
  }

  restart(): void {
    this.stop();
    this.start();
  }

  private async _runAutoNaming(): Promise<void> {
    if (!this.bridge) return;
    const cfg = this.getConfig();
    if (!cfg.aiEnabled || !cfg.autoNaming) return;

    const sessions = await this.bridge.listSessions();
    const now = Date.now();
    const minInterval = (cfg.autoNamingIntervalSecs || 30) * 1000;

    // Process one session at a time to avoid concurrent CLI calls
    for (const session of sessions) {
      const lastTime = this.lastNamed.get(session.id) ?? 0;
      if (now - lastTime < minInterval) continue;
      if (this.inFlight.has(session.id)) continue;

      const defaultName = session.path?.split('/').pop() ?? 'shell';
      const isDefaultName = session.name === defaultName
        || /^\d+$/.test(session.name)
        || session.name === 'shell'
        || session.name === 'zsh'
        || session.name === 'bash'
        || session.name === 'fish';
      const looksAiNamed = /[\u{1F300}-\u{1FAFF}]/u.test(session.name) || session.name.split(/\s+/).length > 2;
      if (!isDefaultName && !looksAiNamed) continue;

      this.inFlight.add(session.id);
      try {
        await this._nameSession(session.id, cfg.aiProvider);
      } finally {
        this.inFlight.delete(session.id);
        this.lastNamed.set(session.id, Date.now());
      }
    }
  }

  private async _nameSession(sessionId: string, provider: AIProvider): Promise<void> {
    try {
      // Capture last ~2000 chars of terminal output
      const { stdout: paneContent } = await execAsync(
        `tmux capture-pane -p -S -100 -t '${sessionId.replace(/'/g, "'\\''")}' 2>/dev/null`,
        { timeout: 5000 }
      );
      const text = paneContent.trim();
      if (!text || text.length < 10) return;

      // Take last 2000 chars to keep prompt small
      const snippet = text.length > 2000 ? text.slice(-2000) : text;

      // Skip if terminal content hasn't changed since last naming
      const contentHash = simpleHash(snippet);
      if (this.lastContentHash.get(sessionId) === contentHash) {
        logger.debug(`AI naming ${sessionId}: content unchanged, skipping`);
        return;
      }

      const prompt = `Based on this terminal output, give a very short name (max 6 words) for this terminal session. Use lowercase, no title case, no emojis, no quotes. Just output the name, nothing else.\n\nTerminal output:\n${snippet}`;

      const cli = provider === 'claude-code' ? 'claude' : 'codex';

      logger.debug(`AI naming ${sessionId}: calling ${cli} (${snippet.length} chars of terminal)`);
      const t0 = Date.now();

      let name: string;
      if (cli === 'claude') {
        // Use --verbose --output-format json to get the full message array,
        // then extract the assistant text. Plain -p returns empty result field.
        const raw = await runWithStdin(
          'claude',
          ['-p', '--model', 'haiku', '--verbose', '--output-format', 'json', prompt],
          '',
        );
        name = '';
        try {
          const events = JSON.parse(raw);
          if (Array.isArray(events)) {
            for (const evt of events) {
              if (evt.type === 'assistant' && evt.message?.content) {
                for (const block of evt.message.content) {
                  if (block.type === 'text' && block.text) { name = block.text.trim(); break; }
                }
                if (name) break;
              }
            }
          } else if (events.result) {
            name = (events.result as string).trim();
          }
        } catch {
          // If JSON parse fails, try using raw output
          name = raw.trim();
        }
      } else {
        name = (await runWithStdin('codex', ['-p', prompt], '')).trim();
      }

      logger.debug(`AI naming ${sessionId}: got "${name}" in ${Date.now() - t0}ms`);

      if (!name || name.length > 80 || name.includes('\n')) return;

      // Disable tmux automatic-rename so it doesn't overwrite our name
      await execAsync(`tmux set-option -t '${sessionId.replace(/'/g, "'\\''")}' automatic-rename off 2>/dev/null`).catch(() => {});
      await this.bridge!.renameSession(sessionId, name);
      this.lastContentHash.set(sessionId, contentHash);
      logger.info(`AI renamed ${sessionId} → "${name}"`);
    } catch (e) {
      logger.debug(`AI naming failed for ${sessionId}: ${e}`);
    }
  }
}