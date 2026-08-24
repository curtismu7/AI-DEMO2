'use strict';

/**
 * enterpriseIdpClientRegistry.js — OAuth clients registered with the demo
 * Enterprise IdP (legs 1-2 of MCP Enterprise-Managed Authorization). Mirrors
 * oauth-mcp/src/oauth/ClientRegistry.ts's shape at the scale this surface
 * needs today: one real, persistent-for-the-process registry, seeded with a
 * stable client for MCP Inspector so there's something to paste into its
 * Client Settings dialog immediately.
 *
 * The seeded client's identity is read via configStore.getEffective(), not
 * raw process.env — that's what gives it vault-backed persistence (see
 * ENV_FALLBACK_MAP in configStore.js): ENTERPRISE_IDP_INSPECTOR_CLIENT_ID is
 * a plain demo_api_server/.env value, ENTERPRISE_IDP_INSPECTOR_CLIENT_SECRET
 * lives in secrets.vault. Without either set, it still falls back to a
 * random client generated once per process (dev convenience), but then
 * rotates on every restart.
 *
 * ponytail: the REGISTRY itself is in-memory only, no disk persistence — a
 * restart still re-seeds the (now-stable) client rather than reading a
 * previously-registered one back. Add disk persistence, mirroring
 * ClientRegistry.ts's TOKEN_STORAGE_PATH/ENCRYPTION_KEY option, if a second
 * external EMA client needs to self-register (not just this one seeded
 * entry) and survive a restart.
 */

const crypto = require('crypto');
const configStore = require('./configStore');

let clients = new Map();
let seededInspectorClient = null;

function registerClient(client) {
  clients.set(client.client_id, client);
  return client;
}

function getClient(clientId) {
  return clients.get(clientId);
}

function validateRedirectUri(clientId, redirectUri) {
  const client = getClient(clientId);
  return Boolean(client && client.redirect_uris.includes(redirectUri));
}

function timingSafeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));
  } catch {
    return false; // different byte lengths — not equal
  }
}

function validateClientCredentials(clientId, clientSecret) {
  const client = getClient(clientId);
  return Boolean(client && timingSafeEqual(client.client_secret, clientSecret));
}

/** Seeds (once) and returns the fixed MCP Inspector client. */
function getSeededInspectorClient() {
  if (seededInspectorClient) return seededInspectorClient;

  const clientId = configStore.getEffective('enterprise_idp_inspector_client_id') || crypto.randomUUID();
  const clientSecret = configStore.getEffective('enterprise_idp_inspector_client_secret') || crypto.randomBytes(32).toString('base64url');
  const redirectUris = process.env.ENTERPRISE_IDP_INSPECTOR_REDIRECT_URIS
    ? process.env.ENTERPRISE_IDP_INSPECTOR_REDIRECT_URIS.split(',').map((s) => s.trim())
    : ['http://127.0.0.1:6274/oauth/callback'];

  seededInspectorClient = registerClient({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: 'MCP Inspector — Enterprise-Managed Authorization demo',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
  });
  return seededInspectorClient;
}

/** Test-only: clears the registry and re-seeding memo. */
function resetForTests() {
  clients = new Map();
  seededInspectorClient = null;
}

module.exports = { registerClient, getClient, validateRedirectUri, validateClientCredentials, getSeededInspectorClient, resetForTests };
