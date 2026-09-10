'use strict';

// The store backs the illustrative OAuth-config admin page for banking-mcp.
// The one invariant that matters: a saved client secret is never handed back
// in plaintext, and leaving the secret field blank on a later save keeps the
// previously saved secret instead of wiping it.

const store = require('../services/mcpOAuthConfigStore');
const lmdb = require('../services/lmdb/mcpOAuthConfigStore.lmdb');

const RECORD_ID = 'banking-mcp';

describe('mcpOAuthConfigStore', () => {
  beforeEach(() => {
    lmdb.deleteConfig(RECORD_ID);
  });

  test('returns an empty, unsaved config when nothing has been saved', () => {
    const config = store.getConfig();
    expect(config.hasClientSecret).toBe(false);
    expect(config.clientId).toBe('');
  });

  test('saveConfig never returns the secret, only whether one is set', () => {
    const saved = store.saveConfig({
      clientId: 'client-1',
      clientSecret: 'super-secret',
      issuer: 'https://auth.pingone.com/env-1/as',
      tokenEndpoint: 'https://auth.pingone.com/env-1/as/token',
      scopes: 'read mcp:invoke',
      audience: 'mcpgateway.ping.demo',
    });

    expect(saved.clientSecret).toBeUndefined();
    expect(saved.hasClientSecret).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('super-secret');

    const fetched = store.getConfig();
    expect(fetched.hasClientSecret).toBe(true);
    expect(fetched.clientId).toBe('client-1');
  });

  test('saving with a blank secret keeps the previously saved secret', () => {
    store.saveConfig({
      clientId: 'a', clientSecret: 'secret-a', issuer: 'i', tokenEndpoint: 't', scopes: 's', audience: 'aud',
    });
    store.saveConfig({
      clientId: 'a-renamed', clientSecret: '', issuer: 'i', tokenEndpoint: 't', scopes: 's', audience: 'aud',
    });

    const withSecret = store.getConfigWithSecret();
    expect(withSecret.clientId).toBe('a-renamed');
    expect(withSecret.clientSecret).toBe('secret-a');
  });
});
