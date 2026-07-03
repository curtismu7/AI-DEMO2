/**
 * CIMD register-by-URL (mock AS side) — draft-ietf-oauth-client-id-metadata-document.
 *
 * PingOne does NOT support CIMD, so the demo API server mocks the AS side:
 * a URL-shaped client_id is resolved by fetching the client metadata document
 * from that URL, validating it with the EXISTING Phase 57-01 registration rules
 * (grant allow-list, scope validator), and persisting the registration in the
 * existing LMDB-backed client registry. Every result is badged engine:'mock'.
 *
 * fetch is injected (opts.fetchImpl) so these tests never hit the network.
 */
'use strict';

const registry = require('../../services/oauthClientRegistry');
const clientStore = require('../../services/lmdb/clientRegistryStore.lmdb');

const DOC_URL =
  'http://localhost:3001/api/cimd/agents/super-banking-investment-advisor-agent/client-metadata.json';

const VALID_DOC = {
  client_id: DOC_URL,
  client_name: 'Demo AI App - Investment Advisor Agent',
  grant_types: ['client_credentials'],
  scope: 'invest:read read',
  token_endpoint_auth_method: 'client_secret_basic',
};

/** Minimal fetch-shaped stub: returns the given document (or per-URL factory). */
const makeFetch = (doc) =>
  jest.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => (typeof doc === 'function' ? doc(url) : doc),
  }));

const stepById = (result, id) => result.steps.find((s) => s.step === id);

describe('CIMD register-by-URL (mocked AS)', () => {
  beforeEach(() => {
    registry.clearRegistry();
  });

  describe('client_id URL policy', () => {
    test('rejects a non-URL client_id without fetching', async () => {
      const fetchImpl = makeFetch(VALID_DOC);
      const result = await registry.registerClientByUrl('mcp-client-abc123', {}, { fetchImpl });

      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/URL/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('rejects plain http for a non-local, non-demo host without fetching', async () => {
      const url = 'http://evil.example.com/client-metadata.json';
      const fetchImpl = makeFetch({ ...VALID_DOC, client_id: url });
      const result = await registry.registerClientByUrl(url, {}, { fetchImpl });

      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/https/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('accepts https for any host', async () => {
      const url = 'https://agents.example.com/client-metadata.json';
      const fetchImpl = makeFetch({ ...VALID_DOC, client_id: url });
      const result = await registry.registerClientByUrl(url, {}, { fetchImpl });

      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('document validation', () => {
    test('rejects when client_id inside the document does not equal the document URL', async () => {
      const fetchImpl = makeFetch({ ...VALID_DOC, client_id: 'https://elsewhere.example.com/other.json' });
      const result = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl });

      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/client_id.*must equal/i);
      expect(stepById(result, 'validate').status).toBe('failed');
      // Nothing registered.
      expect(() => registry.getClient(DOC_URL)).toThrow('Client not found');
    });

    test('rejects a grant type outside the existing allow-list', async () => {
      const fetchImpl = makeFetch({ ...VALID_DOC, grant_types: ['authorization_code'] });
      const result = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl });

      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/grant_types/);
      expect(stepById(result, 'validate').status).toBe('failed');
    });

    test('rejects unknown scopes via the existing scope validator', async () => {
      const fetchImpl = makeFetch({ ...VALID_DOC, scope: 'not:a:real:scope' });
      const result = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl });

      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/scope/i);
    });
  });

  describe('happy path', () => {
    test('registers the client keyed by its URL and persists it', async () => {
      const fetchImpl = makeFetch(VALID_DOC);
      const result = await registry.registerClientByUrl(DOC_URL, { sourceIP: '127.0.0.1' }, { fetchImpl });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      // The CIMD essence: the client_id IS the document URL.
      expect(result.client.client_id).toBe(DOC_URL);
      expect(result.client.registration_type).toBe('cimd');
      expect(result.client.engine).toBe('mock');
      expect(result.client.scope).toBe('invest:read read');

      // All three steps succeed and are badged mocked.
      expect(result.steps.map((s) => s.step)).toEqual(['fetch', 'validate', 'register']);
      expect(result.steps.every((s) => s.status === 'success')).toBe(true);
      expect(result.steps.every((s) => s.engine === 'mock')).toBe(true);

      // Retrievable through the existing registry API…
      expect(registry.getClient(DOC_URL).client_name).toBe(VALID_DOC.client_name);
      // …and written through to the existing LMDB store.
      expect(clientStore.loadClients().map(([id]) => id)).toContain(DOC_URL);
    });

    test('the main AI Agent registers cleanly with its topology scope agent:invoke', async () => {
      const url = 'http://localhost:3001/api/cimd/agents/super-banking-ai-agent/client-metadata.json';
      const fetchImpl = makeFetch({
        client_id: url,
        client_name: 'Demo AI App - AI Agent Actor',
        grant_types: ['client_credentials'],
        // agent:invoke is defined in scope-topology.json (the SSOT) but not in
        // the MCP tool-scope map — the validator must accept topology scopes.
        scope: 'agent:invoke',
        token_endpoint_auth_method: 'client_secret_basic',
      });

      const result = await registry.registerClientByUrl(url, {}, { fetchImpl });

      expect(result.errors).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.client.client_id).toBe(url);
      expect(result.client.scope).toBe('agent:invoke');
      expect(result.steps.every((s) => s.status === 'success')).toBe(true);
    });
  });

  describe('document cache', () => {
    test('a second registration within the TTL uses the cached document (no refetch)', async () => {
      const fetchImpl = makeFetch(VALID_DOC);

      const first = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl });
      const second = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(stepById(first, 'fetch').detail.cache).toBe('miss');
      expect(stepById(second, 'fetch').detail.cache).toBe('hit');
    });

    test('after TTL expiry the document is refetched; the client keeps its secret', async () => {
      const fetchImpl = makeFetch(VALID_DOC);

      const first = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl, ttlMs: 25 });
      await new Promise((r) => setTimeout(r, 40));
      const second = await registry.registerClientByUrl(DOC_URL, {}, { fetchImpl, ttlMs: 25 });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(stepById(second, 'fetch').detail.cache).toBe('miss');
      // Re-resolution updates the record but does not rotate credentials.
      expect(second.client.client_secret).toBe(first.client.client_secret);
      expect(second.client.client_id_issued_at).toBe(first.client.client_id_issued_at);
    });
  });
});
