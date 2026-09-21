'use strict';

const crypto = require('crypto');
const oauthClientRegistry = require('./oauthClientRegistry');
const store = require('./lmdb/personalAgentCimdStore.lmdb');

const PERSONAL_AGENT_SCOPES = ['agent:invoke', 'airlines:read', 'airlines:write'];

function userKey(user) {
  return String(user?.oauthId || user?.id || '').trim();
}

function displayName(user) {
  return user?.username || String(user?.email || 'user').split('@')[0];
}

function clientDisplayName(user) {
  const safe = displayName(user)
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || 'user';
}

function baseUrl() {
  const origin = process.env.BFF_CIMD_ORIGIN || process.env.PUBLIC_APP_URL;
  if (origin) return origin.replace(/\/$/, '');
  return `${process.env.BFF_LOOPBACK_SCHEME || 'http'}://127.0.0.1:${process.env.PORT || 3001}`;
}

function metadataUrl(registrationId) {
  return `${baseUrl()}/api/cimd/personal-agents/${registrationId}/client-metadata.json`;
}

function publicRecord(record) {
  if (!record) return null;
  return {
    userKey: record.userKey,
    agentType: record.agentType || 'personal',
    pingoneAgentId: record.pingoneAgentId,
    pingoneAgentName: record.pingoneAgentName,
    registrationId: record.registrationId,
    registrationType: record.registrationType,
    status: record.status,
    metadataUrl: record.metadataUrl,
    clientId: record.clientId,
    metadata: { ...record.metadata },
    steps: record.steps,
    registeredAt: record.registeredAt,
  };
}

function getPersonalAgentCimd(user, options = {}) {
  const key = userKey(user);
  return key ? publicRecord(store.get(key, options.agentType || 'personal')) : null;
}

async function ensurePersonalAgentCimd(user, pingoneAgent, options = {}) {
  const agentType = options.agentType || 'personal';
  const existing = getPersonalAgentCimd(user, { agentType });
  if (existing && existing.pingoneAgentId === pingoneAgent?.id && existing.status === 'registered') {
    return { ...existing, ok: true, mocked: true, created: false };
  }
  return registerPersonalAgentCimd(user, pingoneAgent, { agentType });
}

function getByRegistrationId(registrationId) {
  const match = store.loadAll().find(([, record]) => record.registrationId === registrationId);
  return match ? publicRecord(match[1]) : null;
}

function getByPingoneAgentId(pingoneAgentId) {
  const match = store.loadAll().find(([, record]) => record.pingoneAgentId === pingoneAgentId);
  return match ? publicRecord(match[1]) : null;
}

function metadataFor(record) {
  return {
    client_id: record.metadataUrl,
    client_name: record.metadata.client_name,
    grant_types: ['client_credentials'],
    scope: PERSONAL_AGENT_SCOPES.join(' '),
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

async function registerPersonalAgentCimd(user, pingoneAgent, options = {}) {
  const agentType = options.agentType || 'personal';
  const key = userKey(user);
  if (!key) throw new Error('Personal agent CIMD registration requires a user subject');
  if (!pingoneAgent?.id) throw new Error('Personal agent CIMD registration requires a PingOne agent');

  const existing = store.get(key, agentType);
  if (existing && existing.pingoneAgentId === pingoneAgent.id && existing.status === 'registered') {
    return { ...publicRecord(existing), ok: existing.status === 'registered', mocked: true, created: false };
  }

  const registrationId = crypto.randomUUID();
  const record = existing && existing.pingoneAgentId === pingoneAgent.id ? {
    ...existing,
    status: 'pending',
    steps: [],
    registeredAt: new Date().toISOString(),
  } : {
    userKey: key,
    agentType,
    pingoneAgentId: pingoneAgent.id,
    pingoneAgentName: pingoneAgent.name || `AI Agent - ${displayName(user)}`,
    registrationId,
    registrationType: 'cimd-facade',
    status: 'pending',
    metadataUrl: metadataUrl(registrationId),
    clientId: metadataUrl(registrationId),
    metadata: {
      client_name: `${agentType === 'saas-embedded-worker' ? 'Website Worker' : 'Personal AI Agent'} - ${clientDisplayName(user)}`,
      grant_types: ['client_credentials'],
      scope: PERSONAL_AGENT_SCOPES.join(' '),
      token_endpoint_auth_method: 'client_secret_basic',
    },
    steps: [],
    registeredAt: new Date().toISOString(),
  };

  store.put(record);
  try {
    const result = await oauthClientRegistry.registerClientByUrl(
      record.metadataUrl,
      { registeredBy: 'personal-agent-cimd-facade', sourceIP: 'bff' },
      { fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => ({ ...metadataFor(record), client_id: url }) }) },
    );
    record.steps = result.steps || [];
    record.status = result.ok ? 'registered' : 'failed';
    store.put(record);
    return { ...publicRecord(record), ok: result.ok, mocked: true, created: true };
  } catch (err) {
    record.status = 'failed';
    record.steps = [{ step: 'register', status: 'failed', engine: 'mock', detail: { error: err.message } }];
    store.put(record);
    return { ...publicRecord(record), ok: false, mocked: true, created: true };
  }
}

async function removePersonalAgentCimd(user, pingoneAgentId, options = {}) {
  const agentType = options.agentType || 'personal';
  const key = userKey(user);
  if (!key) return { removed: false };
  const record = store.get(key, agentType);
  if (!record || (pingoneAgentId && record.pingoneAgentId !== pingoneAgentId)) {
    return { removed: false };
  }

  try {
    oauthClientRegistry.deleteClient(record.clientId, {
      deletedBy: 'personal-agent-cimd-cleanup',
      sourceIP: 'bff',
    });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  store.remove(key, agentType);
  return { removed: true, registrationId: record.registrationId, clientId: record.clientId };
}

function metadataDocument(registrationId) {
  const record = getByRegistrationId(registrationId);
  if (!record) return null;
  return { ...record.metadata, client_id: record.metadataUrl };
}

module.exports = {
  PERSONAL_AGENT_SCOPES,
  userKey,
  getPersonalAgentCimd,
  ensurePersonalAgentCimd,
  getByRegistrationId,
  getByPingoneAgentId,
  metadataDocument,
  registerPersonalAgentCimd,
  removePersonalAgentCimd,
};
