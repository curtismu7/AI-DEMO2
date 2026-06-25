/**
 * Phase 1 persistence: DCR-registered OAuth clients + CIMD documents must
 * survive a server restart. setup.js points LMDB_PATH at a throwaway per-worker
 * dir, so these tests exercise the real LMDB write-through + hydrate path.
 *
 * "Restart" is simulated with jest.resetModules(): the LMDB file persists (same
 * LMDB_PATH) while the module-level in-memory Maps are rebuilt empty, exactly as
 * on a real boot before hydrate() runs.
 */
'use strict';

const VALID_CLIENT = {
  client_name: 'Persisted MCP Client',
  client_type: 'confidential',
  grant_types: ['client_credentials'],
  scope: ['read', 'write'],
  token_endpoint_auth_method: 'client_secret_basic',
};

describe('OAuth client registry — LMDB persistence', () => {
  afterEach(() => {
    // Wipe both the in-memory Maps and the LMDB rows so files sharing this
    // worker's throwaway store don't inherit our clients.
    require('../../services/oauthClientRegistry').clearRegistry();
    jest.resetModules();
  });

  test('a registered client is written through to LMDB', async () => {
    const registry = require('../../services/oauthClientRegistry');
    const store = require('../../services/lmdb/clientRegistryStore.lmdb');

    const created = await registry.registerOAuthClient(VALID_CLIENT, { registeredBy: 'test' });

    const persisted = store.loadClients().map(([id]) => id);
    expect(persisted).toContain(created.client_id);
  });

  test('hydrate() restores clients after a simulated restart', async () => {
    const registry = require('../../services/oauthClientRegistry');
    const created = await registry.registerOAuthClient(VALID_CLIENT, { registeredBy: 'test' });

    // Simulate restart: fresh module (empty Maps), same LMDB file.
    jest.resetModules();
    const rebooted = require('../../services/oauthClientRegistry');

    // Before hydrate the client is gone from memory.
    expect(() => rebooted.getClient(created.client_id)).toThrow(/not found/i);

    rebooted.hydrate();

    const restored = rebooted.getClient(created.client_id, true);
    expect(restored.client_id).toBe(created.client_id);
    expect(restored.client_secret).toBe(created.client_secret);
    expect(restored.client_name).toBe(VALID_CLIENT.client_name);
  });

  test('a deleted client does not reappear after restart', async () => {
    const registry = require('../../services/oauthClientRegistry');
    const created = await registry.registerOAuthClient(VALID_CLIENT, { registeredBy: 'test' });
    registry.deleteClient(created.client_id);

    jest.resetModules();
    const rebooted = require('../../services/oauthClientRegistry');
    rebooted.hydrate();

    expect(() => rebooted.getClient(created.client_id)).toThrow(/not found/i);
  });

  test('a rotated secret persists across restart', async () => {
    const registry = require('../../services/oauthClientRegistry');
    const created = await registry.registerOAuthClient(VALID_CLIENT, { registeredBy: 'test' });
    const rotated = registry.rotateClientSecret(created.client_id, { reason: 'test' });

    jest.resetModules();
    const rebooted = require('../../services/oauthClientRegistry');
    rebooted.hydrate();

    const restored = rebooted.getClient(created.client_id, true);
    expect(restored.client_secret).toBe(rotated.client_secret);
    expect(restored.client_secret).not.toBe(created.client_secret);
  });
});

describe('CIMD store — LMDB persistence', () => {
  afterEach(() => {
    require('../../services/lmdb/cimdStore.lmdb').clearAll();
    jest.resetModules();
  });

  test('hydrate() restores CIMD docs so the well-known route serves them after restart', () => {
    const cimdLmdb = require('../../services/lmdb/cimdStore.lmdb');
    const appId = 'app-persist-123';
    const doc = { client_id: `https://demo/.well-known/oauth-client/${appId}`, client_name: 'CIMD Client' };
    cimdLmdb.put(appId, doc);

    // Simulate restart: re-require the route module (empty Map) and hydrate.
    jest.resetModules();
    const { wellKnownHandler, hydrate } = require('../../routes/clientRegistration');
    hydrate();

    const res = mockRes();
    wellKnownHandler({ params: { clientId: appId } }, res);

    expect(res.statusCode).toBeNull(); // 200 (status() not called on success)
    expect(res.body).toEqual(doc);
  });
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
