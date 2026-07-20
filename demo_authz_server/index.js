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

// Async-route wrapper: a handler that throws or rejects is routed to the error
// middleware below instead of surfacing as an unhandledRejection (which, under
// Node's default, terminates the process). Without this, one malformed request
// body — e.g. a non-string scope field — could crash the whole authz server.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/as/token', wrap(require('./routes/token')));
app.post('/as/introspect', wrap(require('./routes/introspect')));
app.post('/governance/pap/alpha/policy/:workerId/decision', wrap(require('./routes/decision')));
app.get('/rules', wrap(require('./routes/rules')));

// Editable rule overrides (admin round-trip editor; env-gated X-Authz-Admin-Token guard).
const { putHandler: rulesPutHandler, resetHandler: rulesResetHandler } = require('./routes/rulesWrite');
app.put('/rules', wrap(rulesPutHandler));
app.post('/rules/reset', wrap(rulesResetHandler));

// Snapshot import/export for authz-server parity validation
const upload = multer({ storage: multer.memoryStorage() });
app.post('/admin/import-snapshot', upload.single('snapshot'), wrap(require('./routes/import-snapshot')));
app.get('/admin/current-snapshot', wrap(require('./routes/generate-snapshot')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pingone-authz-server-mock', port: PORT });
});

// ─── Error handling ──────────────────────────────────────────────────────────
// Single net for sync throws, rejected async handlers (via wrap()), and
// malformed-JSON body-parser errors. Returns a generic body so internal detail
// and stack traces never reach the caller. Malformed JSON → 400, everything
// else → 500. Guards res.headersSent so it can't double-send mid-response.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const isBadJson = err && (err.type === 'entity.parse.failed' || err.status === 400);
  const status = isBadJson ? 400 : 500;
  console.error('[AuthzServer] request error:', err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(status).json({ error: isBadJson ? 'invalid_request' : 'internal_error' });
});

// Process-level backstops: a stray rejection must not silently terminate the
// mock authz server mid-demo. Log and keep serving; only a truly uncaught
// exception (corrupt state) warrants exit.
process.on('unhandledRejection', (reason) => {
  console.error('[AuthzServer] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[AuthzServer] uncaughtException:', err);
  process.exit(1);
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
