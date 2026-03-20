#!/usr/bin/env node
import { Command } from 'commander';
import { TmuxBridge } from './bridge.js';
import { MemoryStore } from './memory.js';
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
    await memory.start();

    const bridge = new TmuxBridge();
    bridge.setMemory(memory);
    await bridge.start();

    const server = await createApp(bridge, memory);

    server.listen(port, host, () => {
      logger.info(`vipershell listening on http://${host}:${port}`);
    });

    const shutdown = async () => {
      logger.info('Shutting down…');
      bridge.stop();
      memory.close();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
