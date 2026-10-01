'use strict';

const oauthClientRegistry = require('./oauthClientRegistry');
const store = require('./lmdb/externalAgentCimdStore.lmdb');

const CALLBACK_PATH = '/api/external-agents/callback';
const ENGINES = ['mock', 'pingfederate'];
const MAX_FETCHES = 20;

const AGENTS = [
  {
    slug: 'acme-travel-agent',
    clientName: 'Acme Travel Agent External',
    clientUri: 'https://travel.acme.example',
    mockScope: 'agent:invoke',
    pfScope: 'openid profile email',
  },
];

const fetchLog = new Map();

function getAgent(slug) {
  return AGENTS.find((a) => a.slug === slug) || null;
}

function metadataPath(slug, engine) {
  return `/api/external-agents/${slug}/${engine}/client-metadata.json`;
}

function metadataDocument(slug, engine, origin) {
  const agent = getAgent(slug);
  if (!agent || !ENGINES.includes(engine)) return null;
  const base = String(origin).replace(/\/$/, '');
  const common = {
    client_id: `${base}${metadataPath(slug, engine)}`,
    client_name: agent.clientName,
    client_uri: agent.clientUri,
  };
  if (engine === 'pingfederate') {
    return {
      ...common,
      redirect_uris: [`${base}${CALLBACK_PATH}`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: agent.pfScope,
      token_endpoint_auth_method: 'none',
    };
  }
  return {
    ...common,
    grant_types: ['client_credentials'],
    scope: agent.mockScope,
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

function recordFetch(slug, engine, userAgent) {
  const key = `${slug}:${engine}`;
  const list = fetchLog.get(key) || [];
  list.unshift({ at: new Date().toISOString(), userAgent: String(userAgent || '').slice(0, 200) });
  fetchLog.set(key, list.slice(0, MAX_FETCHES));
}

function recentFetches(slug, engine) {
  return [...(fetchLog.get(`${slug}:${engine}`) || [])];
}

function userKey(user) {
  return String(user?.oauthId || user?.id || '').trim();
}

function mockOrigin() {
  const origin = process.env.BFF_CIMD_ORIGIN || process.env.PUBLIC_APP_URL;
  if (origin) return origin.replace(/\/$/, '');
  return `${process.env.BFF_LOOPBACK_SCHEME || 'http'}://127.0.0.1:${process.env.PORT || 3001}`;
}

function saveRegistration({ user, slug, engine, clientId, metadataUrl, subject = null, steps = [] }) {
  const key = userKey(user);
  if (!key) throw new Error('External agent registration requires a user subject');
  const record = {
    userKey: key,
    slug,
    engine,
    agentName: getAgent(slug)?.clientName || slug,
    clientId,
    metadataUrl,
    status: 'registered',
    subject,
    steps,
    registeredAt: new Date().toISOString(),
  };
  store.put(record);
  return record;
}

function getRegistration(user, slug, engine) {
  return store.get(userKey(user), slug, engine);
}

function listRegistrations() {
  return store.loadAll().map(([, record]) => record);
}

async function registerMock(user, slug) {
  const doc = metadataDocument(slug, 'mock', mockOrigin());
  if (!doc) return { ok: false, engine: 'mock', error: 'agent_not_found' };
  const result = await oauthClientRegistry.registerClientByUrl(
    doc.client_id,
    { registeredBy: 'external-agent-cimd-facade', sourceIP: 'bff' },
    { fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => ({ ...doc, client_id: url }) }) },
  );
  if (!result.ok) return { ok: false, engine: 'mock', error: 'mock_registration_failed', steps: result.steps || [] };
  const record = saveRegistration({
    user, slug, engine: 'mock', clientId: doc.client_id, metadataUrl: doc.client_id, steps: result.steps || [],
  });
  return { ok: true, engine: 'mock', record, steps: record.steps };
}

module.exports = {
  AGENTS,
  CALLBACK_PATH,
  ENGINES,
  getAgent,
  metadataPath,
  metadataDocument,
  recordFetch,
  recentFetches,
  userKey,
  saveRegistration,
  getRegistration,
  listRegistrations,
  registerMock,
};
