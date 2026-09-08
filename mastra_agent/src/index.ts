import express, { type Request, type Response } from 'express';
import { getConfig } from './config';
import { handleRun } from './runHandler';
import { exporter as metricsExporter, runDuration, runErrors } from './metrics';

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mastra_agent' });
});

// Prometheus scrape target — unauthenticated, same posture as the other
// Node MCP services' /metrics routes (monitoring/prometheus.yml already
// trusts the internal network for scraping).
app.get('/metrics', (req, res) => {
  metricsExporter.getMetricsRequestHandler(req, res);
});

app.post('/run', async (req: Request, res: Response) => {
  const start = process.hrtime.bigint();
  try {
    await handleRun(req, res);
    runDuration.record(Number(process.hrtime.bigint() - start) / 1e9);
  } catch (err) {
    runDuration.record(Number(process.hrtime.bigint() - start) / 1e9);
    runErrors.add(1);
    throw err;
  }
});

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
