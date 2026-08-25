'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => '') }));

const configStore = require('../../services/configStore');
const registry = require('../../services/enterpriseIdpClientRegistry');

describe('enterpriseIdpClientRegistry', () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    registry.resetForTests();
    configStore.getEffective.mockReset();
    configStore.getEffective.mockReturnValue('');
    delete process.env.ENTERPRISE_IDP_INSPECTOR_REDIRECT_URIS;
  });
  afterEach(() => { process.env = { ...ORIG }; registry.resetForTests(); });

  test('registerClient then getClient returns the registered record', () => {
    registry.registerClient({ client_id: 'c1', client_secret: 's1', redirect_uris: ['https://x/cb'] });
    expect(registry.getClient('c1')).toMatchObject({ client_id: 'c1', client_secret: 's1' });
  });

  test('getClient returns undefined for an unknown client_id', () => {
    expect(registry.getClient('never-registered')).toBeUndefined();
  });

  test('validateRedirectUri is true only for a registered redirect_uri of that client', () => {
    registry.registerClient({ client_id: 'c1', client_secret: 's1', redirect_uris: ['https://x/cb'] });
    expect(registry.validateRedirectUri('c1', 'https://x/cb')).toBe(true);
    expect(registry.validateRedirectUri('c1', 'https://evil.example/cb')).toBe(false);
  });

  test('seeds a stable Inspector client at http://127.0.0.1:6274/oauth/callback when no env override is set', () => {
    const client = registry.getSeededInspectorClient();
    expect(client.redirect_uris).toContain('http://127.0.0.1:6274/oauth/callback');
    expect(registry.getClient(client.client_id)).toMatchObject({ client_id: client.client_id });
  });

  test('honours configStore enterprise_idp_inspector_client_id/secret for the seeded client (env + vault backed)', () => {
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'enterprise_idp_inspector_client_id') return 'fixed-id';
      if (k === 'enterprise_idp_inspector_client_secret') return 'fixed-secret';
      return '';
    });
    const client = registry.getSeededInspectorClient();
    expect(client.client_id).toBe('fixed-id');
    expect(client.client_secret).toBe('fixed-secret');
  });

  test('validateClientCredentials is true only for the correct client_id/secret pair', () => {
    registry.registerClient({ client_id: 'c1', client_secret: 's1', redirect_uris: [] });
    expect(registry.validateClientCredentials('c1', 's1')).toBe(true);
    expect(registry.validateClientCredentials('c1', 'wrong')).toBe(false);
    expect(registry.validateClientCredentials('never-registered', 's1')).toBe(false);
  });

  test('is stable across calls (memoised, not re-seeded)', () => {
    const a = registry.getSeededInspectorClient();
    const b = registry.getSeededInspectorClient();
    expect(a.client_id).toBe(b.client_id);
    expect(a.client_secret).toBe(b.client_secret);
  });
});
