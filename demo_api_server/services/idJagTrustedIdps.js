'use strict';

/**
 * Trusted-IdP registry for "bring your own ID-JAG": outside IdPs whose ID-JAGs our resource
 * authorization servers (oauth-mcp, the local PingFederate) accept. Self-contained on purpose so
 * it can move into a standalone app later: the only dependency is the key/value configStore.
 *
 * Entries hold no secrets (issuer, JWKS URL, client ids, scope cap), so the public read shapes
 * below are safe to serve unauthenticated to oauth-mcp and the PingFederate sync script.
 */

const configStore = require('./configStore');

const STORE_KEY = 'id_jag_trusted_idps';
const TARGETS = ['oauth-mcp', 'pingfederate'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DEFAULTS = { clientId: 'demo-bff-mcp-client', pfClientId: 'ai-demo-pf-idjag-redeemer' };

function list() {
  const raw = configStore.getEffective(STORE_KEY);
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const save = (entries) => configStore.setRaw({ [STORE_KEY]: JSON.stringify(entries) });

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Kept exactly as typed: the issuer is compared byte-for-byte with the ID-JAG's iss.
function httpsUrl(value, field) {
  const s = str(value);
  try {
    if (new URL(s).protocol === 'https:') return s;
  } catch { /* fall through */ }
  throw badRequest(`${field} must be an https URL`);
}

/** Normalize and validate one entry against the others (id and issuer must be unique). */
function validate(input, others) {
  if (!input || typeof input !== 'object') throw badRequest('body must be an object');
  const id = str(input.id).toLowerCase();
  if (!SLUG.test(id)) throw badRequest('id must be a slug (lowercase letters, digits, dashes)');
  const name = str(input.name);
  if (!name) throw badRequest('name is required');
  const issuer = httpsUrl(input.issuer, 'issuer');
  const jwksUrl = httpsUrl(input.jwksUrl, 'jwksUrl');
  const idJagClientId = str(input.idJagClientId);
  if (!idJagClientId) throw badRequest('idJagClientId is required');
  const targets = Array.isArray(input.targets) ? [...new Set(input.targets)] : [];
  if (!targets.length || targets.some((t) => !TARGETS.includes(t))) throw badRequest(`targets must be a non-empty subset of ${TARGETS.join(', ')}`);
  if (typeof input.scopes !== 'undefined' && typeof input.scopes !== 'string') throw badRequest('scopes must be a space-separated string');
  if (others.some((e) => e.id === id)) throw badRequest(`id "${id}" is already used`);
  if (others.some((e) => e.issuer === issuer)) throw badRequest(`issuer ${issuer} is already registered`);
  return {
    id, name, issuer, jwksUrl, idJagClientId,
    clientId: str(input.clientId) || DEFAULTS.clientId,
    pfClientId: str(input.pfClientId) || DEFAULTS.pfClientId,
    scopes: str(input.scopes).split(/\s+/).filter(Boolean).join(' '),
    targets,
    enabled: input.enabled !== false,
  };
}

async function create(input) {
  const entries = list();
  const entry = validate(input, entries);
  await save([...entries, entry]);
  return entry;
}

function notFound(id) {
  const err = new Error(`no trusted IdP "${id}"`);
  err.status = 404;
  return err;
}

async function update(id, input) {
  const entries = list();
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) throw notFound(id);
  const entry = validate({ ...input, id }, entries.filter((_, j) => j !== i));
  entries[i] = entry;
  await save(entries);
  return entry;
}

async function remove(id) {
  const entries = list();
  if (!entries.some((e) => e.id === id)) throw notFound(id);
  await save(entries.filter((e) => e.id !== id));
}

/** Enabled entry for an issuer (exact match), or null. */
const findByIssuer = (iss) => list().find((e) => e.enabled && e.issuer === iss) || null;
const findById = (id) => list().find((e) => e.id === id) || null;

const enabledFor = (target) => list().filter((e) => e.enabled && e.targets.includes(target));

/** What oauth-mcp reads server-to-server. */
const oauthMcpRegistry = () => ({
  idps: enabledFor('oauth-mcp').map((e) => ({
    id: e.id, issuer: e.issuer, jwksUrl: e.jwksUrl, clientAliases: { [e.idJagClientId]: e.clientId }, scopes: e.scopes,
  })),
});

/** What a PingFederate sync script reads to build IdP connections. */
const pingfederateRegistry = () => ({
  idps: enabledFor('pingfederate').map((e) => ({
    id: e.id, name: e.name, issuer: e.issuer, jwksUrl: e.jwksUrl, pfClientId: e.pfClientId, scopes: e.scopes,
  })),
});

module.exports = {
  STORE_KEY, TARGETS, list, create, update, remove, findByIssuer, findById, oauthMcpRegistry, pingfederateRegistry,
};
