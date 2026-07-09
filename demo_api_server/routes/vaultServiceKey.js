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
const ALLOWED = new Set(['DEMO_MORTGAGE_SERVICE_KEY', 'DEMO_INVEST_SERVICE_KEY']);

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
  // getEffective resolves FIELD_DEFS defaults + env aliases (DEMO_MORTGAGE_SERVICE_KEY)
  // so the bridge works before vault-migrate has seeded LMDB/vault entries.
  const value = configStore.getEffective(name.toLowerCase());
  if (value === null || value === undefined || value === '') {
    return res.status(404).json({ error: 'key_unset' });
  }
  return res.status(200).json({ name, value });
});

module.exports = router;
