'use strict';

/**
 * banking-hitl-service — entry point
 *
 * Standalone REST service for Human-in-the-Loop approval flows.
 * Extracted from banking_api_server (transactionConsentChallenge.js + cibaService.js).
 *
 * REST API:
 *   POST   /challenges               — MCP Gateway creates a HITL challenge
 *   GET    /challenges/:id           — MCP Gateway polls for decision
 *   POST   /challenges/:id/respond   — Human approves or denies via dashboard/webhook
 *   GET    /challenges               — Dashboard lists pending challenges
 *   GET    /health                   — liveness probe
 *
 * Token flow:
 *   MCP Gateway → POST /challenges (internal service call, no user token required)
 *   Dashboard   → POST /challenges/:id/respond (user token from OLB App session)
 *
 * Start: node src/index.js
 */

require('dotenv').config();

const express = require('express');
const challengeRoutes = require('./routes/challenges');
const { teachLog } = require('./teachLogger');
const { correlationMiddleware } = require('./correlationMiddleware');

const PORT = parseInt(process.env.PORT || '3009', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json());
app.use(correlationMiddleware);

// CORS — allow OLB dashboard and MCP Gateway
const ALLOWED_ORIGINS = (process.env.HITL_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Startup env validation — warn loudly so run.sh log tail shows the issue
if (!ALLOWED_ORIGINS.length) {
  teachLog.warn('HITL_ALLOWED_ORIGINS is not set — CORS will allow all origins', {
    hint: 'Set HITL_ALLOWED_ORIGINS=https://api.ping.demo:4000,https://api.ping.demo:3005 in demo_api_server/.env',
  });
}

const _envOk = ALLOWED_ORIGINS.length > 0;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!ALLOWED_ORIGINS.length || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Health — includes uptime and env check result
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'banking-hitl-service',
    uptime: process.uptime(),
    checks: {
      env: _envOk ? 'ok' : 'warn',
    },
  });
});

// Challenge routes
app.use('/challenges', challengeRoutes);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  teachLog.error('unhandled error', err, { message: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, HOST, () => {
  teachLog.info('hitl service listening', {
    host: HOST,
    port: PORT,
    notifyMode: process.env.HITL_NOTIFY_MODE || 'log',
    dashboardUrl: process.env.HITL_DASHBOARD_URL || 'http://localhost:3000/dashboard/approve',
  });
  teachLog.info('hitl service ready', { port: PORT });
});

// Graceful shutdown — drain in-flight requests before exit
const shutdown = (signal) => {
  teachLog.info('shutdown signal received', { signal });
  server.close(() => {
    teachLog.info('http server closed');
    process.exit(0);
  });
  setTimeout(() => {
    teachLog.error('drain timeout — forcing exit', undefined, {});
    process.exit(1);
  }, 5000);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
