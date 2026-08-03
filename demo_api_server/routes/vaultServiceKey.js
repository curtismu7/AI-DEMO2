'use strict';

// Internal, gateway-only endpoint: serves the demo backend API keys IG injects
// as X-API-Key. NOT under /api/*; NOT browser-facing. Guarded by the shared
// BFF_INTERNAL_SECRET and a hard allow-list so a real secret can never leak.
const express = require('express');
const configStore = require('../services/configStore');

const router = express.Router();

const {
  isDefaultInternalSecret,
  internalSecretMatches,
} = require('../utils/internalSecret');

// Hardening: the committed default secret is public knowledge, so a caller
// presenting it could retrieve backend service keys. When the secret is
// unset/default in a deployed environment, disable this endpoint entirely rather
// than trust the well-known literal. Locally the default stays usable so a fresh
// clone runs.
//
// This deliberately does NOT key off NODE_ENV. k8s/20-api-server-deployment.yaml
// and docker-compose.yml both pin the BFF to NODE_ENV=development on purpose (the
// simulated Authorize service refuses to load otherwise), so the old
// `NODE_ENV === 'production'` condition could never fire in any real deployment —
// the guard was dead code everywhere it mattered. VAULT_INTERNAL_STRICT=true is an
// explicit opt-in that deploys set regardless of NODE_ENV.
// Evaluated per request, not at module load: this router is mounted long before
// the vault opens, so a module-scope snapshot would judge the secret before the
// vault had a chance to supply it.
const isStrict = () => process.env.VAULT_INTERNAL_STRICT === 'true';
const disabledInsecure = () => isDefaultInternalSecret() && isStrict();

// The ONLY names this endpoint will ever return. Demo backend keys only.
const ALLOWED = new Set(['DEMO_API_RESOURCE_SERVER_KEY', 'DEMO_MCP_RESOURCE_SERVER_KEY']);

// Committed defaults the mortgage backend hard-rejects at boot (see
// demo_api_resource_server/server.js and ensure-service-keys.js KNOWN_DEFAULTS).
const KNOWN_DEFAULT_KEYS = new Set(['demo-mortgage-key-0000', 'mortgage-compose-dev-key']);

router.get('/vault/service-key', (req, res) => {
  if (disabledInsecure()) {
    console.error('[vaultServiceKey] BFF_INTERNAL_SECRET is unset/default under VAULT_INTERNAL_STRICT — endpoint DISABLED (503).');
    return res.status(503).json({ error: 'vault_disabled_insecure_secret' });
  }
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
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
  // ("backend rejected the service API key") several hops downstream. When
  // strict, fail HERE with an explicit provisioning error instead.
  // Locally the default stays servable so a fresh clone still runs.
  if (isStrict() && KNOWN_DEFAULT_KEYS.has(value)) {
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
