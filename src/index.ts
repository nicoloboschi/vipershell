#!/usr/bin/env node
import { Command } from 'commander';
import { TmuxBridge } from './bridge.js';
import { MemoryStore } from './memory.js';
import { AIService } from './ai.js';
import { createApp, logger } from './server.js';
import { config } from './config.js';

const program = new Command();

program
  .name('vipershell')
  .description('Your machine, anywhere — tmux sessions in your browser')
  .version('0.1.0')
  .option('--host <host>', 'Host to bind to', config.host)
  .option('--port <port>', 'Port to listen on', String(config.port))
  .option('--log-level <level>', 'Log level (debug|info|warning|error)', config.logLevel)
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const host = opts.host;

    const memory = new MemoryStore();
    memory.startInBackground();

    const bridge = new TmuxBridge();
    bridge.setMemory(memory);
    await bridge.start();

    const ai = new AIService();
    ai.setBridge(bridge);
    ai.start();

    const server = await createApp(bridge, memory, ai);

    server.listen(port, host, () => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
      console.log('');
      console.log('  \x1b[1m\x1b[32m\u{1F40D} vipershell\x1b[0m');
      console.log('');
      console.log(`  \x1b[2mLocal:\x1b[0m   ${url}`);
      if (host === '0.0.0.0') console.log(`  \x1b[2mNetwork:\x1b[0m http://0.0.0.0:${port}`);
      console.log('');
      logger.info(`vipershell listening on ${url}`);
    });

    const shutdown = async () => {
      logger.info('Shutting down\u2026');
      ai.stop();
      bridge.stop();
      memory.close();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
