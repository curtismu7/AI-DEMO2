'use strict';

jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({
  get: jest.fn(),
  decryptClientSecret: jest.fn(),
}));
jest.mock('../services/scopeTopology', () => ({
  toolScopes: jest.fn((tool) => (tool === 'checkout' ? ['write'] : ['read'])),
}));

const store = require('../services/lmdb/delegatedCommerceStore.lmdb');
const runtime = require('../services/delegatedCommerceRuntime');

function req() {
  return {
    user: { id: 'user-1' },
    session: { delegatedCommerceRegistrationId: 'reg-1' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('resolves request-scoped credentials for the claimed active registration', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
    expiresAt: Date.now() + 60000,
  });
  runtime.holdCredentials('reg-1', { clientSecret: 'server-only-secret' });
  expect(runtime.resolveAgentRuntime(req())).toEqual(
    expect.objectContaining({ clientId: 'agent-new', clientSecret: 'server-only-secret' }),
  );
});

it('fails closed after customer revocation', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'revoked',
    scopes: ['read'],
    expiresAt: Date.now() + 60000,
  });
  expect(() => runtime.resolveAgentRuntime(req())).toThrow(
    'The delegated agent authorization is not active.',
  );
});

it('restores the encrypted registration secret after a process restart', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
    expiresAt: Date.now() + 60000,
    encryptedClientSecret: 'encrypted',
  });
  runtime.removeCredentials('reg-1');
  store.decryptClientSecret.mockReturnValue('restored-server-secret');

  expect(runtime.resolveAgentRuntime(req())).toEqual(
    expect.objectContaining({ clientSecret: 'restored-server-secret' }),
  );
});

it('uses the configured agent until claimed registration receives consent', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'claimed',
    expiresAt: Date.now() + 60000,
  });

  expect(runtime.resolveAgentRuntime(req(), { fallbackToDefault: true })).toBeNull();
});

it('reports read-only consent as insufficient for checkout', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
    expiresAt: Date.now() + 60000,
  });
  expect(runtime.resolveConsentContext(req(), 'checkout')).toEqual(
    expect.objectContaining({
      consentScopes: ['read'],
      requiredScopes: ['write'],
      sufficient: false,
    }),
  );
});

it('reports expired registrations as insufficient consent', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
    expiresAt: Date.now() - 1,
  });

  expect(runtime.resolveConsentContext(req(), 'list_orders')).toEqual(
    expect.objectContaining({ status: 'expired', sufficient: false }),
  );
});
