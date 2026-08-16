'use strict';

jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({
  get: jest.fn(),
  decryptClientSecret: jest.fn(),
}));
jest.mock('../services/scopeTopology', () => ({
  toolScopes: jest.fn((tool) => (tool === 'checkout' ? ['write'] : ['read'])),
}));

const store = require('../services/lmdb/delegatedCommerceStore.lmdb');
const scopeTopology = require('../services/scopeTopology');
const runtime = require('../services/delegatedCommerceRuntime');

// Register a mocked active registration with the given consent scopes, then
// make scopeTopology.toolScopes return the real namespaced required scopes for
// the tool under test.
function activeReg(consentScopes) {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: consentScopes,
    expiresAt: Date.now() + 60000,
  });
}

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

it('does not enforce consent until the claimed registration is activated', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'claimed',
    scopes: [],
    expiresAt: Date.now() + 60000,
  });

  expect(runtime.resolveConsentContext(req(), 'checkout')).toBeNull();
});

it('ignores orphaned delegated-commerce session ids', () => {
  store.get.mockReturnValue(null);

  expect(runtime.resolveConsentContext(req(), 'list_orders')).toBeNull();
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

it('keeps revoked registrations insufficient so post-revoke tool retries deny', () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'revoked',
    scopes: ['read', 'write'],
    expiresAt: Date.now() + 60000,
  });

  expect(runtime.resolveConsentContext(req(), 'list_orders')).toEqual(
    expect.objectContaining({ status: 'revoked', sufficient: false }),
  );
});

// Regression: namespaced tool scopes must not be filtered away. Before the fix
// the required set was reduced to bare 'read'/'write', so 'sensitive:read',
// 'transfer', and 'airlines:*' were dropped and read-only consent passed.
describe('namespaced required scopes are enforced against read/write consent', () => {
  it('denies read-only consent on get_sensitive_account_details (read + sensitive:read)', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['read', 'sensitive:read']);
    expect(runtime.resolveConsentContext(req(), 'get_sensitive_account_details')).toEqual(
      expect.objectContaining({
        consentScopes: ['read'],
        requiredScopes: ['read', 'sensitive:read'],
        sufficient: false,
      }),
    );
  });

  it('denies read-only consent on create_wire_transfer (read + transfer)', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['read', 'transfer']);
    expect(runtime.resolveConsentContext(req(), 'create_wire_transfer')).toEqual(
      expect.objectContaining({ requiredScopes: ['read', 'transfer'], sufficient: false }),
    );
  });

  it('denies read-only consent on redeem_miles (airlines:read + airlines:write, no bare read/write)', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['airlines:read', 'airlines:write']);
    expect(runtime.resolveConsentContext(req(), 'redeem_miles')).toEqual(
      expect.objectContaining({
        requiredScopes: ['airlines:read', 'airlines:write'],
        sufficient: false,
      }),
    );
  });

  it('denies read-only consent on pay_airline_fee (airlines:read + airlines:write)', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['airlines:read', 'airlines:write']);
    expect(runtime.resolveConsentContext(req(), 'pay_airline_fee')).toMatchObject({
      sufficient: false,
    });
  });

  it('allows a write-consented agent on get_sensitive_account_details', () => {
    activeReg(['read', 'write']);
    scopeTopology.toolScopes.mockReturnValueOnce(['read', 'sensitive:read']);
    expect(runtime.resolveConsentContext(req(), 'get_sensitive_account_details')).toMatchObject({
      sufficient: true,
    });
  });

  it('allows a write-consented agent on redeem_miles', () => {
    activeReg(['read', 'write']);
    scopeTopology.toolScopes.mockReturnValueOnce(['airlines:read', 'airlines:write']);
    expect(runtime.resolveConsentContext(req(), 'redeem_miles')).toMatchObject({
      sufficient: true,
    });
  });

  it('keeps banking create_transfer gating unchanged: read-only denied, write allowed', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['write', 'transfer']);
    expect(runtime.resolveConsentContext(req(), 'create_transfer')).toMatchObject({
      sufficient: false,
    });

    activeReg(['read', 'write']);
    scopeTopology.toolScopes.mockReturnValueOnce(['write', 'transfer']);
    expect(runtime.resolveConsentContext(req(), 'create_transfer')).toMatchObject({
      sufficient: true,
    });
  });

  it('allows read consent on a legitimate read-only tool (airlines:read)', () => {
    activeReg(['read']);
    scopeTopology.toolScopes.mockReturnValueOnce(['airlines:read']);
    expect(runtime.resolveConsentContext(req(), 'list_airline_reservations')).toMatchObject({
      sufficient: true,
    });
  });
});
