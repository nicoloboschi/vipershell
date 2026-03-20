import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface Config {
  host: string;
  port: number;
  logLevel: string;
}

function loadConfig(): Partial<Config> {
  try {
    const configPath = join(homedir(), '.config', 'vipershell', 'config.json');
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const fileConfig = loadConfig();

export const config: Config = {
  host: process.env.VIPERSHELL_HOST ?? fileConfig.host ?? '0.0.0.0',
  port: parseInt(process.env.VIPERSHELL_PORT ?? String(fileConfig.port ?? 4445)),
  logLevel: process.env.VIPERSHELL_LOG_LEVEL ?? fileConfig.logLevel ?? 'info',
};
