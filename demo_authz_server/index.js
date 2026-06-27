'use strict';

/**
 * PingOne Authorization Server (Mock)
 *
 * Implements the PingOne Authorize API so the MCP Gateway can delegate ALL
 * authorization decisions here — the same API real PingOne Authorize exposes.
 * When real PingOne Authorize is configured, set the gateway's
 * PINGAUTHORIZE_ENDPOINT to the real URL and this service is no longer needed.
 *
 * Responsibilities:
 *   1. RFC 7662 Token Introspection  — POST /as/introspect
 *      Validates token: decodes JWT, checks exp, checks aud, checks act claim.
 *      Calls real PingOne introspection endpoint if GW_INTROSPECTION_ENDPOINT is set.
 *
 *   2. PingOne Authorize decisions   — POST /governance/pap/alpha/policy/:workerId/decision
 *      Evaluates: scope, act claim, HITL for write tools.
 *      Returns: { decision: 'PERMIT' | 'DENY' | 'INDETERMINATE' }
 *
 * Port: AUTHZ_PORT (default 9001)
 */

const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: false})); // RFC 7662 §2.1: introspect must accept form-encoded
app.use(require('./correlationId')); // bind the gateway-forwarded correlation id to the request context

const PORT = parseInt(process.env.AUTHZ_PORT || '9001', 10);
const HOST = process.env.HOST || '127.0.0.1';

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/as/token', require('./routes/token'));
app.post('/as/introspect', require('./routes/introspect'));
app.post('/governance/pap/alpha/policy/:workerId/decision', require('./routes/decision'));
app.get('/rules', require('./routes/rules'));

// Editable rule overrides (admin round-trip editor; env-gated X-Authz-Admin-Token guard).
const { putHandler: rulesPutHandler, resetHandler: rulesResetHandler } = require('./routes/rulesWrite');
app.put('/rules', rulesPutHandler);
app.post('/rules/reset', rulesResetHandler);

// Snapshot import/export for authz-server parity validation
const upload = multer({ storage: multer.memoryStorage() });
app.post('/admin/import-snapshot', upload.single('snapshot'), require('./routes/import-snapshot'));
const fs = require('fs');
const CURRENT_SNAPSHOT_PATH = path.join(__dirname, '../snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json');
app.get('/admin/current-snapshot', function(_req, res) {
  if (!fs.existsSync(CURRENT_SNAPSHOT_PATH)) {
    return res.status(404).json({ error: 'snapshot_not_found' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="Super_Banking_Transaction_Authorization_P1AZ.snapshot.json"');
  res.sendFile(CURRENT_SNAPSHOT_PATH);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pingone-authz-server-mock', port: PORT });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`[AuthzServer] PingOne Authorization Server (mock) listening on :${PORT}`);
  console.log(`[AuthzServer] Token Exchange: POST http://localhost:${PORT}/as/token`);
  console.log(`[AuthzServer] Introspection: POST http://localhost:${PORT}/as/introspect`);
  console.log(`[AuthzServer] Decision:      POST http://localhost:${PORT}/governance/pap/alpha/policy/:workerId/decision`);

  const upstreamIntrospect = process.env.PINGONE_INTROSPECTION_ENDPOINT;
  if (upstreamIntrospect) {
    console.log(`[AuthzServer] Delegating introspection to upstream: ${upstreamIntrospect}`);
  } else {
    console.log('[AuthzServer] Introspection: local JWT decode only (no upstream PingOne configured)');
  }
});
