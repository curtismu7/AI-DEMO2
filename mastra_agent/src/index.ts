import express from 'express';
import { getConfig } from './config';
import { handleRun } from './runHandler';

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mastra_agent' });
});
app.post('/run', handleRun);

const cfg = getConfig();
app.listen(cfg.port, cfg.host, () => {
  console.log(`[mastra] listening on ${cfg.host}:${cfg.port}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[mastra] unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[mastra] uncaughtException', err);
  process.exit(1);
});
