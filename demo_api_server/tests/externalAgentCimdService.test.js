'use strict';

jest.mock('../services/lmdb/externalAgentCimdStore.lmdb', () => {
  const map = new Map();
  return {
    put: (r) => map.set(`${r.userKey}:${r.slug}:${r.engine}`, r),
    get: (u, s, e) => map.get(`${u}:${s}:${e}`) || null,
    loadAll: () => [...map.entries()],
    clearAll: () => map.clear(),
  };
});

const svc = require('../services/externalAgentCimdService');
const store = require('../services/lmdb/externalAgentCimdStore.lmdb');

const user = { oauthId: 'user-1', username: 'alex' };

beforeEach(() => store.clearAll());

describe('externalAgentCimdService', () => {
  test('publishes an engine-specific document whose client_id is its own URL', () => {
    const doc = svc.metadataDocument('acme-travel-agent', 'pingfederate', 'https://bff.example.test');
    expect(doc.client_id).toBe('https://bff.example.test/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json');
    expect(doc.redirect_uris).toEqual(['https://bff.example.test/api/external-agents/callback']);
    expect(doc.grant_types).toEqual(['authorization_code']);
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc).not.toHaveProperty('client_secret');
  });

  test('the mock document is a confidential client the mock registry accepts', () => {
    const doc = svc.metadataDocument('acme-travel-agent', 'mock', 'http://127.0.0.1:3001');
    expect(doc.grant_types).toEqual(['client_credentials']);
    expect(doc.token_endpoint_auth_method).toBe('client_secret_basic');
  });

  test('unknown slug or engine yields no document', () => {
    expect(svc.metadataDocument('nope', 'mock', 'http://x')).toBeNull();
    expect(svc.metadataDocument('acme-travel-agent', 'other', 'http://x')).toBeNull();
  });

  test('records metadata fetches as evidence, newest first, capped', () => {
    for (let i = 0; i < 25; i += 1) svc.recordFetch('acme-travel-agent', 'pingfederate', `ua-${i}`);
    const fetches = svc.recentFetches('acme-travel-agent', 'pingfederate');
    expect(fetches).toHaveLength(20);
    expect(fetches[0].userAgent).toBe('ua-24');
    expect(svc.recentFetches('acme-travel-agent', 'mock')).toEqual([]);
  });

  test('registerMock registers through the mock registry and saves an engine=mock record; twice is one record', async () => {
    const first = await svc.registerMock(user, 'acme-travel-agent');
    expect(first.ok).toBe(true);
    expect(first.record).toMatchObject({ engine: 'mock', slug: 'acme-travel-agent', status: 'registered', subject: null });
    expect(first.record.steps.map((s) => s.step)).toEqual(['fetch', 'validate', 'register']);
    await svc.registerMock(user, 'acme-travel-agent');
    expect(svc.listRegistrations()).toHaveLength(1);
    expect(JSON.stringify(first)).not.toMatch(/client_secret/);
  });

  test('saveRegistration is an upsert keyed by user, slug and engine', () => {
    svc.saveRegistration({ user, slug: 'acme-travel-agent', engine: 'pingfederate', clientId: 'https://c', metadataUrl: 'https://c', subject: 'pf-sub' });
    svc.saveRegistration({ user, slug: 'acme-travel-agent', engine: 'pingfederate', clientId: 'https://c', metadataUrl: 'https://c', subject: 'pf-sub' });
    expect(svc.listRegistrations()).toHaveLength(1);
    expect(svc.getRegistration(user, 'acme-travel-agent', 'pingfederate').subject).toBe('pf-sub');
  });
});
