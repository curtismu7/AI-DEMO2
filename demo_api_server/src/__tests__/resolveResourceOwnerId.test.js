'use strict';
/**
 * resolveResourceOwnerId — NNP-3 / UC10 ResourceOwnerId population.
 *
 * UC10 routes get_account_balance through the full pipeline and expects
 * Authorize to DENY on ResourceOwnerMismatch. That only fires when
 * ResourceOwnerId is present and differs from subjectId (oauthId space).
 */

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  getAll: jest.fn(() => ({})),
}));
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(() => false),
  evaluateTransaction: jest.fn(async () => ({ decision: 'PERMIT' })),
}));
jest.mock('../../services/simulatedAuthorizeService', () => ({
  evaluateMcpFirstTool: jest.fn(),
  isSimulatedModeEnabled: jest.fn(() => true),
  resolveAuthorizeMode: jest.fn(() => ({ failoverMode: 'deny' })),
  buildAuthorizeFallbackSignal: jest.fn(),
  buildPolicyNotFoundBody: jest.fn(),
}));
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  verifyHitlReceipt: jest.fn(),
}));

const mockGetAccountById = jest.fn();
const mockGetUserById = jest.fn();
jest.mock('../../data/store', () => ({
  getAccountById: (...args) => mockGetAccountById(...args),
  getUserById: (...args) => mockGetUserById(...args),
}));

const {
  resolveResourceOwnerId,
  RESOURCE_OWNER_TOOLS,
} = require('../../services/mcpToolAuthorizationService');

beforeEach(() => {
  mockGetAccountById.mockReset();
  mockGetUserById.mockReset();
});

describe('resolveResourceOwnerId', () => {
  test('covers get_account_balance and update_contact_email', () => {
    expect(RESOURCE_OWNER_TOOLS.has('get_account_balance')).toBe(true);
    expect(RESOURCE_OWNER_TOOLS.has('update_contact_email')).toBe(true);
    expect(RESOURCE_OWNER_TOOLS.has('get_my_accounts')).toBe(false);
  });

  test('UC10 tool: returns owner oauthId when present (subjectId space)', () => {
    mockGetAccountById.mockReturnValue({ id: '3', userId: '2' });
    mockGetUserById.mockReturnValue({ id: '2', oauthId: 'pingone-uuid-owner' });

    expect(resolveResourceOwnerId('get_account_balance', { account_id: '3' }))
      .toBe('pingone-uuid-owner');
    expect(mockGetAccountById).toHaveBeenCalledWith('3');
  });

  test('falls back to store user id when oauthId is absent', () => {
    mockGetAccountById.mockReturnValue({ id: '3', userId: '2' });
    mockGetUserById.mockReturnValue({ id: '2' });

    expect(resolveResourceOwnerId('get_account_balance', { account_id: '3' }))
      .toBe('2');
  });

  test('own-account shape: owner oauthId matches a PingOne-linked subject', () => {
    mockGetAccountById.mockReturnValue({ id: '1', userId: '5' });
    mockGetUserById.mockReturnValue({ id: '5', oauthId: 'demo-user-sub' });

    const ownerId = resolveResourceOwnerId('get_account_balance', { account_id: '1' });
    expect(ownerId).toBe('demo-user-sub');
    // Gate compares ResourceOwnerId to subjectId (= userSub); equal → PERMIT.
    expect(ownerId).toBe('demo-user-sub');
  });

  test('update_contact_email still resolved (regression)', () => {
    mockGetAccountById.mockReturnValue({ id: '9', userId: '1' });
    mockGetUserById.mockReturnValue({ id: '1', oauthId: 'owner-sub' });

    expect(resolveResourceOwnerId('update_contact_email', { account_id: '9' }))
      .toBe('owner-sub');
  });

  test('returns null for unknown account or non-scoped tool', () => {
    mockGetAccountById.mockReturnValue(null);
    expect(resolveResourceOwnerId('get_account_balance', { account_id: 'missing' })).toBeNull();
    expect(resolveResourceOwnerId('create_transfer', { account_id: '3' })).toBeNull();
    expect(resolveResourceOwnerId('get_account_balance', {})).toBeNull();
  });
});
