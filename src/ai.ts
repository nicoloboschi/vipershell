import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from './server.js';
import type { TmuxBridge } from './bridge.js';

const execAsync = promisify(exec);
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

    for (const session of sessions) {
      // Skip sessions that were recently named or are in-flight
      const lastTime = this.lastNamed.get(session.id) ?? 0;
      if (now - lastTime < minInterval) continue;
      if (this.inFlight.has(session.id)) continue;

      // Skip sessions that already have a user-set name (not the default tmux name)
      // Default tmux names are digits or the path basename
      const defaultName = session.path?.split('/').pop() ?? 'shell';
      const isDefaultName = session.name === defaultName
        || /^\d+$/.test(session.name)
        || session.name === 'shell'
        || session.name === 'zsh'
        || session.name === 'bash'
        || session.name === 'fish';
      // Only rename sessions with default-looking names OR previous AI names
      // AI names contain emojis or multi-word descriptions
      const looksAiNamed = /[\u{1F300}-\u{1FAFF}]/u.test(session.name) || session.name.split(/\s+/).length > 2;
      if (!isDefaultName && !looksAiNamed) continue;

      this.inFlight.add(session.id);
      this._nameSession(session.id, cfg.aiProvider).finally(() => {
        this.inFlight.delete(session.id);
        this.lastNamed.set(session.id, Date.now());
      });
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

      const prompt = `Based on this terminal output, give a very short name (max 6 words) for this session. Start with a relevant emoji. Just output the name, nothing else. No quotes.\n\nTerminal output:\n${snippet}`;

      let name: string;
      if (provider === 'claude-code') {
        const { stdout } = await execAsync(
          `echo ${shellEscape(prompt)} | claude --print -`,
          { timeout: 30_000, env: { ...process.env, LANG: 'en_US.UTF-8' } }
        );
        name = stdout.trim();
      } else {
        // codex
        const { stdout } = await execAsync(
          `echo ${shellEscape(prompt)} | codex --print -`,
          { timeout: 30_000, env: { ...process.env, LANG: 'en_US.UTF-8' } }
        );
        name = stdout.trim();
      }

      if (!name || name.length > 80 || name.includes('\n')) return;

      // Rename the tmux session
      await this.bridge!.renameSession(sessionId, name);
      logger.debug(`AI renamed session ${sessionId} → "${name}"`);
    } catch (e) {
      logger.debug(`AI naming failed for ${sessionId}: ${e}`);
    }
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
