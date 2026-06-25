import express from 'express';
import { getConfig } from './config';
import { handleRun } from './runHandler';

const app = express();
app.use(express.json());
app.post('/run', handleRun);

const cfg = getConfig();
app.listen(cfg.port, cfg.host, () => {
  console.log(`[mastra] listening on ${cfg.host}:${cfg.port}`);
});
