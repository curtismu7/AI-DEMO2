/**
 * agentBuilderService.js
 *
 * Self-service per-user agent identity in PingOne, for the /agent-builder page.
 * All Management API calls run server-side with the worker token — the browser
 * never sees PingOne credentials. Every object this service creates carries a
 * description marker including the owner's sub; the marker is the ownership
 * guard on every delete path, so topology/provisioned objects are untouchable
 * from this page.
 *
 * AI agents are PingOne applications with type "AI_AGENT" on the standard
 * /applications surface (verified live 2026-06-12 — a console-created agent
 * appears in GET /applications and matches filter=type eq "AI_AGENT"; there is
 * no separate /aiAgents endpoint). createAgentForUser() creates an AI_AGENT
 * first and falls back to a standard OIDC WEB_APP only when the environment
 * rejects the type. WEB_APP (not WORKER) because PingOne forbids
 * resource-scope grants on WORKER apps, which would break "Apply grants".
 */
'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken } = require('./pingOneClientService');
const { getCanonicalPublicOrigin } = require('./vercelPublicUrl');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');

const BUILDER_MARKER = 'Created by Agent Builder for ';

function ownerKey(user) {
  return user.oauthId || user.id;
}

function displayName(user) {
  return user.username || String(user.email || 'user').split('@')[0];
}

function agentName(user) {
  return `AI Agent - ${displayName(user)}`;
}

function markerFor(user) {
  return `${BUILDER_MARKER}${ownerKey(user)}`;
}

function ownsObject(user, obj) {
  // Exact match — builder-created objects carry exactly this description, and
  // a substring check could false-positive when one owner key prefixes another.
  return obj.description === markerFor(user);
}

function apiBase() {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID not configured');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

// Management tokens live ~1h; cache the request options briefly so one page
// interaction (state = agent + resources + grants) doesn't pay 3+ full
// client_credentials round-trips. 5 min keeps us far from expiry.
const OPTS_CACHE_MS = 5 * 60 * 1000;
let _cachedOpts = null;
let _cachedOptsAt = 0;

async function requestOptions() {
  if (_cachedOpts && Date.now() - _cachedOptsAt < OPTS_CACHE_MS) return _cachedOpts;
  const token = await getManagementToken();
  _cachedOpts = {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  };
  _cachedOptsAt = Date.now();
  return _cachedOpts;
}

/** Re-throw axios errors without `config` (which carries the worker token in
 *  its Authorization header). Keeps `response.{status,data}` so callers can
 *  still map PingOne error bodies; passes non-axios errors through untouched. */
function sanitizePingOneError(err) {
  if (!err || (!err.isAxiosError && !err.config)) return err;
  const e = new Error(err.message);
  e.cause = sanitizeAxiosCause(err);
  e.response = { status: err.response?.status, data: err.response?.data };
  return e;
}

function withSanitizedErrors(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      throw sanitizePingOneError(err);
    }
  };
}

/** True when PingOne's 400 validation error is about the application `type`
 *  field — the signal that this environment doesn't support AI_AGENT. */
function isAgentTypeUnsupported(err) {
  const data = err.response?.data;
  if (err.response?.status !== 400 || !data) return false;
  return (data.details || []).some((d) => d?.target === 'type');
}

function summarizeAgent(app) {
  return {
    id: app.id,
    name: app.name,
    type: app.type || 'AI_AGENT',
    enabled: app.enabled !== false,
    grantTypes: app.grantTypes || [],
    tokenEndpointAuthMethod: app.tokenEndpointAuthMethod || null,
    createdAt: app.createdAt || null,
    fallback: (app.type || 'AI_AGENT') !== 'AI_AGENT',
  };
}

async function listApplicationsRaw(opts) {
  const res = await axios.get(`${apiBase()}/applications?limit=100`, { ...opts, validateStatus: () => true });
  return res.data?._embedded?.applications || [];
}

/** AI_AGENT apps appear in the standard applications list, so one lookup
 *  covers both first-class agents and WEB_APP fallbacks. */
async function findAgentRaw(user, opts) {
  const name = agentName(user);
  const apps = await listApplicationsRaw(opts);
  return apps.find((a) => a.name === name) || null;
}

async function getAgentForUser(user) {
  const opts = await requestOptions();
  const raw = await findAgentRaw(user, opts);
  return raw ? summarizeAgent(raw) : null;
}

/**
 * Create the user's agent. `overrides` carries config copied from an existing
 * agent via the picker: { grantTypes?: string[], tokenEndpointAuthMethod? }.
 * Overrides apply to the AI_AGENT attempt only — the WEB_APP fallback keeps
 * its canonical payload (copied grant types like CLIENT_CREDENTIALS would be
 * rejected on a WEB_APP).
 */
async function createAgentForUser(user, overrides = {}) {
  const opts = await requestOptions();
  const existing = await findAgentRaw(user, opts);
  if (existing) return { created: false, agent: summarizeAgent(existing) };

  const name = agentName(user);
  const description = markerFor(user);

  // First choice: a first-class AI agent — a standard application with
  // type AI_AGENT (same payload shape the console's AI Agents section makes).
  try {
    const aiPayload = {
      name,
      description,
      enabled: true,
      type: 'AI_AGENT',
      protocol: 'OPENID_CONNECT',
      tokenEndpointAuthMethod: overrides.tokenEndpointAuthMethod || 'CLIENT_SECRET_POST',
    };
    if (Array.isArray(overrides.grantTypes) && overrides.grantTypes.length > 0) {
      aiPayload.grantTypes = overrides.grantTypes;
    }
    const res = await axios.post(`${apiBase()}/applications`, aiPayload, { ...opts, validateStatus: () => true });
    return { created: true, agent: summarizeAgent(res.data) };
  } catch (err) {
    if (!isAgentTypeUnsupported(err)) throw err;
  }

  // Fallback: standard OIDC WEB_APP (grant-capable; WORKER apps can't hold
  // resource-scope grants and client_credentials is WORKER-only).
  // Canonical origin resolver (PUBLIC_APP_URL → client URL → Replit → Vercel)
  // — same chain the OAuth redirect-URI writers use, so the registered
  // callback matches the deployed origin on every platform.
  const publicUrl = getCanonicalPublicOrigin() || 'https://localhost:3000';
  const payload = {
    name,
    description,
    enabled: true,
    type: 'WEB_APP',
    protocol: 'OPENID_CONNECT',
    grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
    responseTypes: ['CODE'],
    redirectUris: [`${publicUrl.replace(/\/$/, '')}/agent-builder/callback`],
    tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
    pkceEnforcement: 'OPTIONAL',
  };
  const res = await axios.post(`${apiBase()}/applications`, payload, { ...opts, validateStatus: () => true });
  return { created: true, agent: summarizeAgent(res.data) };
}

async function deleteAgentForUser(user) {
  const opts = await requestOptions();
  const raw = await findAgentRaw(user, opts);
  if (!raw) throw Object.assign(new Error('No agent to delete'), { code: 'not_found' });
  if (!ownsObject(user, raw)) {
    throw Object.assign(new Error('Refusing to delete: app was not created by Agent Builder for this user'), { code: 'forbidden' });
  }
  await axios.delete(`${apiBase()}/applications/${raw.id}`, opts);
}

// Known demo agent clients shown in the picker even when their app type
// isn't AI_AGENT (the env's working agent identities predate the type).
const KNOWN_AGENT_CLIENT_KEYS = ['PINGONE_AGENT_CLIENT_ID', 'PINGONE_AI_AGENT_CLIENT_ID'];

/** Reference agents already in the environment: every AI_AGENT-typed app
 *  plus the demo's known agent clients. Read-only; used by the picker. */
async function listEnvironmentAgents() {
  const opts = await requestOptions();
  const apps = await listApplicationsRaw(opts);
  const knownIds = new Set(
    KNOWN_AGENT_CLIENT_KEYS.map((k) => configStore.getEffective(k)).filter(Boolean)
  );
  return apps
    .filter((a) => a.type === 'AI_AGENT' || knownIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      enabled: a.enabled !== false,
      grantTypes: a.grantTypes || [],
      tokenEndpointAuthMethod: a.tokenEndpointAuthMethod || null,
      builderCreated: typeof a.description === 'string' && a.description.startsWith(BUILDER_MARKER),
    }));
}

/** Full copyable setup of one agent: config + resolved resource-scope grants. */
async function getAgentSetup(appId) {
  const opts = await requestOptions();
  const app = (await axios.get(`${apiBase()}/applications/${appId}`, opts)).data;
  const grants = await getAgentGrants(appId);
  return {
    id: app.id,
    name: app.name,
    type: app.type,
    grantTypes: app.grantTypes || [],
    tokenEndpointAuthMethod: app.tokenEndpointAuthMethod || null,
    grants,
  };
}

/**
 * One-click upgrade of a fallback WEB_APP agent to a first-class AI_AGENT:
 * capture current grants → delete → recreate as AI_AGENT → re-apply grants.
 * The page re-fetches state afterwards, so a partial failure (e.g. re-grant
 * rejected) is visible and recoverable from the UI.
 */
async function upgradeAgentForUser(user) {
  const opts = await requestOptions();
  const raw = await findAgentRaw(user, opts);
  if (!raw) throw Object.assign(new Error('No agent to upgrade'), { code: 'not_found' });
  if (raw.type === 'AI_AGENT') {
    throw Object.assign(new Error('Agent is already a first-class AI_AGENT'), { code: 'invalid' });
  }
  if (!ownsObject(user, raw)) {
    throw Object.assign(new Error('Refusing to upgrade: app was not created by Agent Builder for this user'), { code: 'forbidden' });
  }

  const grants = await getAgentGrants(raw.id);
  const grantList = Object.entries(grants).map(([resourceId, scopes]) => ({ resourceId, scopes }));

  await axios.delete(`${apiBase()}/applications/${raw.id}`, opts);
  const created = await createAgentForUser(user);
  if (grantList.length > 0) {
    await setAgentGrants(created.agent.id, grantList);
  }
  return { ...created, regrantedResources: grantList.length };
}

const RESOURCE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,39}$/;
const SCOPE_NAME_RE = /^[a-z][a-z0-9:_-]{0,39}$/;

async function listResourceScopes(resourceId, opts) {
  const res = await axios.get(`${apiBase()}/resources/${resourceId}/scopes`, opts);
  return res.data?._embedded?.scopes || [];
}

/** CUSTOM resources only (topology-provisioned + this user's own). Other
 *  users' builder-created resources are hidden. */
async function listResourcesForUser(user) {
  const opts = await requestOptions();
  const res = await axios.get(`${apiBase()}/resources?limit=100`, opts);
  const all = res.data?._embedded?.resources || [];
  const custom = all.filter((r) => r.type === 'CUSTOM');
  const visible = custom.filter((r) => {
    const isBuilderCreated = typeof r.description === 'string' && r.description.startsWith(BUILDER_MARKER);
    return !isBuilderCreated || ownsObject(user, r);
  });
  return Promise.all(visible.map(async (r) => ({
    id: r.id,
    name: r.name,
    audience: r.audience || null,
    ownedByUser: ownsObject(user, r),
    scopes: (await listResourceScopes(r.id, opts)).map((s) => s.name),
  })));
}

async function createUserResource(user, { name, audience, scopes }) {
  if (!RESOURCE_NAME_RE.test(String(name || ''))) {
    throw Object.assign(new Error('Resource name must be 2-40 chars: letters, digits, space, _ . -'), { code: 'invalid' });
  }
  const scopeNames = (scopes && scopes.length ? scopes : ['read', 'write', 'admin']).map(String);
  for (const s of scopeNames) {
    if (!SCOPE_NAME_RE.test(s)) {
      throw Object.assign(new Error(`Invalid scope name "${s}" (lowercase, may contain digits : _ -)`), { code: 'invalid' });
    }
  }
  const opts = await requestOptions();
  const fullName = `${displayName(user)} - ${name}`;

  // Idempotent by (user, name).
  const existingList = (await axios.get(`${apiBase()}/resources?limit=100`, opts))
    .data?._embedded?.resources || [];
  const existing = existingList.find((r) => r.name === fullName && ownsObject(user, r));
  if (existing) return { created: false, resource: existing };

  const res = await axios.post(`${apiBase()}/resources`, {
    name: fullName,
    description: markerFor(user),
    type: 'CUSTOM',
    audience: audience || fullName.toLowerCase().replace(/[^a-z0-9.-]+/g, '-'),
  }, opts);
  const resource = res.data;

  for (const scopeName of scopeNames) {
    await axios.post(`${apiBase()}/resources/${resource.id}/scopes`, {
      name: scopeName,
      description: `Scope: ${scopeName}`,
      schema: 'urn:pingone:common:scope',
    }, opts);
  }
  return { created: true, resource };
}

async function deleteUserResource(user, resourceId) {
  const opts = await requestOptions();
  const res = await axios.get(`${apiBase()}/resources/${resourceId}`, opts);
  if (!ownsObject(user, res.data)) {
    throw Object.assign(new Error('Refusing to delete: resource was not created by Agent Builder for this user'), { code: 'forbidden' });
  }
  await axios.delete(`${apiBase()}/resources/${resourceId}`, opts);
}

/** { [resourceId]: [scopeName, …] } currently granted to the app. */
async function getAgentGrants(appId) {
  const opts = await requestOptions();
  const grants = (await axios.get(`${apiBase()}/applications/${appId}/grants`, opts))
    .data?._embedded?.grants || [];
  const out = {};
  await Promise.all(grants.map(async (g) => {
    const rid = g.resource?.id;
    if (!rid) return;
    let scopeList;
    try {
      scopeList = await listResourceScopes(rid, opts);
    } catch (err) {
      // A grant can outlive its resource (or reference one we can't read);
      // skip it rather than bricking the whole /state response.
      if (err.response?.status === 404) return;
      throw err;
    }
    const nameById = new Map(scopeList.map((s) => [s.id, s.name]));
    out[rid] = (g.scopes || []).map((s) => nameById.get(s.id)).filter(Boolean);
  }));
  return out;
}

/**
 * Replace semantics: after this call the app's grants match `desired` exactly.
 * desired: [{ resourceId, scopes: [name, …] }] — entries with empty scopes are
 * treated as "no grant for that resource".
 */
async function setAgentGrants(appId, desired) {
  const opts = await requestOptions();
  const wanted = (desired || []).filter((d) => (d.scopes || []).length > 0);
  const wantedByResource = new Map(wanted.map((d) => [d.resourceId, d.scopes]));

  const existing = (await axios.get(`${apiBase()}/applications/${appId}/grants`, opts))
    .data?._embedded?.grants || [];
  const existingByResource = new Map(existing.map((g) => [g.resource?.id, g]));

  try {
    // Remove grants for resources no longer wanted.
    for (const g of existing) {
      if (!wantedByResource.has(g.resource?.id)) {
        await axios.delete(`${apiBase()}/applications/${appId}/grants/${g.id}`, opts);
      }
    }
    // Create or replace the wanted ones — each resource's grant is
    // independent, so resolve + write them concurrently.
    await Promise.all(wanted.map(async (d) => {
      const scopeList = await listResourceScopes(d.resourceId, opts);
      const idByName = new Map(scopeList.map((s) => [s.name, s.id]));
      const scopeIds = d.scopes.map((n) => idByName.get(n)).filter(Boolean).map((id) => ({ id }));
      if (scopeIds.length === 0) return;
      const payload = { resource: { id: d.resourceId }, scopes: scopeIds };
      const match = existingByResource.get(d.resourceId);
      if (match) {
        await axios.put(`${apiBase()}/applications/${appId}/grants/${match.id}`, payload, opts);
      } else {
        await axios.post(`${apiBase()}/applications/${appId}/grants`, payload, opts);
      }
    }));
  } catch (err) {
    // PingOne global rule: one scope NAME per app across all grants. The
    // message can sit on the top-level body or inside details[] — check both
    // structured fields rather than stringifying the whole envelope.
    const data = err.response?.data || {};
    const detail = [data.message, ...(data.details || []).map((d) => d?.message)]
      .filter(Boolean).join(' ');
    if (err.response?.status === 400 && detail.includes('Multiple scopes with the same name')) {
      throw Object.assign(
        new Error('PingOne allows each scope name to be granted from only ONE resource per application. Uncheck the duplicate scope name on the other resource first.'),
        { code: 'duplicate_scope_name' }
      );
    }
    throw err;
  }
}

module.exports = {
  BUILDER_MARKER,
  agentName,
  getAgentForUser: withSanitizedErrors(getAgentForUser),
  createAgentForUser: withSanitizedErrors(createAgentForUser),
  deleteAgentForUser: withSanitizedErrors(deleteAgentForUser),
  upgradeAgentForUser: withSanitizedErrors(upgradeAgentForUser),
  listEnvironmentAgents: withSanitizedErrors(listEnvironmentAgents),
  getAgentSetup: withSanitizedErrors(getAgentSetup),
  listResourcesForUser: withSanitizedErrors(listResourcesForUser),
  createUserResource: withSanitizedErrors(createUserResource),
  deleteUserResource: withSanitizedErrors(deleteUserResource),
  getAgentGrants: withSanitizedErrors(getAgentGrants),
  setAgentGrants: withSanitizedErrors(setAgentGrants),
};
