'use strict';

/**
 * banking-agent-service — entry point
 *
 * REST API surface:
 *   POST /api/agent/reason — stateless reasoning step (shared-secret gated;
 *                            BFF keeps token custody — no user token crosses
 *                            this boundary)
 *   GET  /health           — liveness probe
 *
 * Start: BFF_INTERNAL_SECRET=... node dist/index.js
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { loadConfig } from './config';
import { loadVaultIntoEnv } from './vault';
import { makeReasonHandler } from './reasonRoute';
import { makeAgentRunHandler } from './agentRunHandler';

// Vault load MUST run (and complete) BEFORE loadConfig() reads process.env.
// loadVaultIntoEnv is async (Argon2id KDF), so — exactly like
// banking_mcp_gateway/src/index.ts — the entire module body is wrapped in a
// single async IIFE. All existing logic below is byte-for-byte preserved
// inside it. dotenv.config() stays at top-of-module (above) so .env still
// loads first for non-secret vars; vault entries override .env per allowlist.
let config: ReturnType<typeof loadConfig>;
(async () => {
try {
  const vaultResult = await loadVaultIntoEnv();
  if (vaultResult.loaded) {
    console.log('[Agent vault] loaded ' + vaultResult.entries + ' entries into process.env');
  }
} catch (err) {
  console.error(
    '[Agent vault] startup load failed; refusing to start.',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}

try {
  config = loadConfig();
} catch (err) {
  console.error('[Agent] Configuration error:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const app = express();

// ---------------------------------------------------------------------------
// POST /api/agent/reason
// :3006 is reasoning-only — the BFF keeps token custody. This endpoint is
// gated by the same x-internal-gateway-secret shared-secret convention as the
// repo's existing /internal/id-token path. Fail hard if the secret is unset so
// a misconfigured deploy can't expose an open reasoning endpoint.
// ---------------------------------------------------------------------------

// Shared secret for the BFF↔:3006 hop. Mirrors banking_api_server/routes/
// agentIdToken.js (/internal/id-token) and must match
// banking_mcp_gateway/src/config.ts DEFAULT_BFF_INTERNAL_SECRET.
const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
if (process.env.NODE_ENV === 'production' && INTERNAL_SECRET === DEFAULT_INTERNAL_SECRET) {
  console.error(
    "[Agent] FATAL: BFF_INTERNAL_SECRET is the committed dev default ('dev-shared-secret-change-me') " +
    'and NODE_ENV=production. Refusing to start. Set BFF_INTERNAL_SECRET to a unique 32+ byte secret.',
  );
  process.exit(1);
}
app.post('/api/agent/reason', express.json({ limit: '256kb' }), makeReasonHandler(INTERNAL_SECRET));

// AG-UI streaming endpoint (Step 1 of AG-UI integration)
app.post('/run', express.json({ limit: '512kb' }), makeAgentRunHandler(INTERNAL_SECRET, config.bffToolUrl || undefined));

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'banking-agent-service',
    uptime: process.uptime(),
    checks: {
      env: 'ok',
    },
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(config.port, config.host, () => {
  console.log(`[Agent] banking-agent-service running on ${config!.host}:${config!.port}`);
  if (config!.host === '0.0.0.0') {
    console.warn(
      `[Agent] ⚠️  Bound to ALL interfaces (0.0.0.0). :3006 is loopback-only per ` +
        `REGRESSION_PLAN §3 — set HOST=127.0.0.1 unless this deploy is firewalled.`,
    );
  }
  console.log(`[Agent] LLM provider: ${config!.llmProvider} / model: ${config!.llmModel}`);
  console.log(`[Agent] Mode: reasoning-only (BFF holds token custody)`);
  console.log(`[Agent] PKI creds: ${config!.usePkiCreds ? 'enabled' : 'disabled (client_secret)'}`);
  console.log(`[demo-agent-service] Ready on :${config!.port}`);
});

const shutdown = (signal: string): void => {
  console.log(`[demo-agent-service] ${signal} received — shutting down`);
  server.close(() => {
    console.log('[demo-agent-service] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[demo-agent-service] Drain timeout — forcing exit');
    process.exit(1);
  }, 5000);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
})();
