'use strict';

const mockRecords = new Map();

jest.mock('../services/lmdb/openEnv', () => ({
  getDb: () => ({
    putSync: (k, v) => mockRecords.set(k, v),
    get:     (k)    => mockRecords.get(k),
    getRange: ()    => [...mockRecords.values()].map(value => ({ value })),
  }),
}));

jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockRejectedValue(new Error('not configured')),
}));
jest.mock('../services/pingoneBootstrapService', () => ({
  fetchFirstPopulationId: jest.fn().mockResolvedValue('pop-id'),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setDelegatedToAttribute: jest.fn().mockResolvedValue(undefined),
}));

const {
  grantDelegation,
  requestApproval,
  resolveApproval,
  findActiveByDelegate,
  getApprovalStatus,
} = require('../services/delegationService');

beforeEach(() => mockRecords.clear());

describe('findActiveByDelegate', () => {
  test('finds an active delegation with create_transfer scope for the delegate user', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['view_accounts', 'create_transfer'],
    });
    // Manually attach a delegate_user_id — grantDelegation leaves it null when
    // PingOne management creds aren't configured (mocked above), but a real
    // grant always sets it once the delegate user is provisioned/found.
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1' };
    mockRecords.set(rec.id, rec);

    const found = await findActiveByDelegate('dana-1');
    expect(found).not.toBeNull();
    expect(found.id).toBe(rec.id);
    expect(found.delegator_user_id).toBe('manager-1');
  });

  test('returns null when the delegate has no active create_transfer delegation', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['view_accounts'], // no create_transfer
    });
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1' };
    mockRecords.set(rec.id, rec);

    expect(await findActiveByDelegate('dana-1')).toBeNull();
  });

  test('returns null for a revoked delegation', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['create_transfer'],
    });
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1', status: 'revoked' };
    mockRecords.set(rec.id, rec);

    expect(await findActiveByDelegate('dana-1')).toBeNull();
  });
});

describe('requestApproval / getApprovalStatus', () => {
  test('writes a pending approval, readable via getApprovalStatus', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;

    const result = await requestApproval(id, {
      authReqId: 'auth-1', amount: 600, tool: 'submit_expense', bindingMessage: 'Approve $600 expense',
    });
    expect(result.ok).toBe(true);

    const status = await getApprovalStatus(id);
    expect(status.status).toBe('pending');
    expect(status.approverUserId).toBe('manager-1');
  });

  test('overwrites a prior pending approval on the same delegation (no queue)', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;

    await requestApproval(id, { authReqId: 'auth-1', amount: 300, tool: 'submit_expense', bindingMessage: 'first' });
    await requestApproval(id, { authReqId: 'auth-2', amount: 600, tool: 'submit_expense', bindingMessage: 'second' });

    const status = await getApprovalStatus(id);
    expect(status.status).toBe('pending');
  });

  test('returns ok:false for an unknown delegation id', async () => {
    const result = await requestApproval('no-such-id', { authReqId: 'a', amount: 1, tool: 't', bindingMessage: 'b' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});

describe('resolveApproval', () => {
  async function seedPending() {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;
    await requestApproval(id, { authReqId: 'auth-1', amount: 600, tool: 'submit_expense', bindingMessage: 'b' });
    return id;
  }

  test('manager approves — status becomes approved', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'manager-1', 'approved');
    expect(result.ok).toBe(true);
    expect((await getApprovalStatus(id)).status).toBe('approved');
  });

  test('manager denies — status becomes denied', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'manager-1', 'denied');
    expect(result.ok).toBe(true);
    expect((await getApprovalStatus(id)).status).toBe('denied');
  });

  test('a non-owner cannot resolve the approval (undifferentiated not_found)', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'someone-else', 'approved');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
    expect((await getApprovalStatus(id)).status).toBe('pending'); // unchanged
  });

  test('resolving an unknown delegation id returns not_found', async () => {
    const result = await resolveApproval('no-such-id', 'manager-1', 'approved');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});
