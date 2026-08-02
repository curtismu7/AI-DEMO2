'use strict';

// Internal, gateway-only endpoint: serves the demo backend API keys IG injects
// as X-API-Key. NOT under /api/*; NOT browser-facing. Guarded by the shared
// BFF_INTERNAL_SECRET and a hard allow-list so a real secret can never leak.
const express = require('express');
const crypto = require('crypto');
const configStore = require('../services/configStore');

const router = express.Router();

const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

// Hardening: the committed default secret is public knowledge, so in production a
// caller presenting it could retrieve backend service keys. When the secret is
// unset/default in production, disable this endpoint entirely rather than trust the
// well-known literal. In dev the default stays usable so the local demo runs.
const SECRET_IS_INSECURE = INTERNAL_SECRET === DEFAULT_INTERNAL_SECRET;
const DISABLED_INSECURE = SECRET_IS_INSECURE && process.env.NODE_ENV === 'production';
if (DISABLED_INSECURE) {
  console.error('[vaultServiceKey] BFF_INTERNAL_SECRET is unset/default in production — endpoint DISABLED (503).');
}

// The ONLY names this endpoint will ever return. Demo backend keys only.
const ALLOWED = new Set(['DEMO_API_RESOURCE_SERVER_KEY', 'DEMO_MCP_RESOURCE_SERVER_KEY']);

// Committed defaults the mortgage backend hard-rejects at boot (see
// demo_api_resource_server/server.js and ensure-service-keys.js KNOWN_DEFAULTS).
const KNOWN_DEFAULT_KEYS = new Set(['demo-mortgage-key-0000', 'mortgage-compose-dev-key']);

function secretOk(presented) {
  const buf = typeof presented === 'string' ? Buffer.from(presented) : null;
  return (
    !!buf &&
    buf.length === INTERNAL_SECRET_BUF.length &&
    crypto.timingSafeEqual(buf, INTERNAL_SECRET_BUF)
  );
}

router.get('/vault/service-key', (req, res) => {
  if (DISABLED_INSECURE) {
    return res.status(503).json({ error: 'vault_disabled_insecure_secret' });
  }
  if (!secretOk(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const name = String(req.query.name || '');
  if (!ALLOWED.has(name)) {
    return res.status(404).json({ error: 'not_allowlisted' });
  }
  // getEffective resolves FIELD_DEFS defaults + env aliases (DEMO_API_RESOURCE_SERVER_KEY)
  // so the bridge works before vault-migrate has seeded LMDB/vault entries.
  const value = configStore.getEffective(name.toLowerCase());
  if (value === null || value === undefined || value === '') {
    return res.status(404).json({ error: 'key_unset' });
  }
  // Mirror demo_api_resource_server's boot guard: the backend hard-rejects the
  // committed defaults, so serving one here can only produce a confusing 401
  // ("backend rejected the service API key") several hops downstream. In
  // production, fail HERE with an explicit provisioning error instead.
  // Locally the default stays servable so a fresh clone still runs.
  if (process.env.NODE_ENV === 'production' && KNOWN_DEFAULT_KEYS.has(value)) {
    console.error(
      `[vaultServiceKey] ${name} resolves to a committed default in production — ` +
      'refusing to serve it. Provision real keys (k8s: create-secrets.sh align_service_api_keys; ' +
      'local: demo_api_server/scripts/ensure-service-keys.js).'
    );
    return res.status(503).json({ error: 'key_not_provisioned' });
  }
  return res.status(200).json({ name, value });
});

module.exports = router;
