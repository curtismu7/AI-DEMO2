'use strict';
jest.mock('../services/lmdb/openEnv', () => {
  const store = new Map();
  const db = {
    putSync: (k, v) => store.set(k, v),
    get: (k) => store.get(k) || null,
    getRange: () => [...store.values()].map(value => ({ value })),
  };
  return { openEnv: () => ({ openDB: () => db }) };
});
const ds = require('../services/lmdb/delegationStore.lmdb');

describe('findActiveByActorAndGrantor', () => {
  beforeEach(() => {
    // clear by re-requiring fresh store — mock store persists between tests
    // so we just grant unique IDs per test
  });

  it('returns the active record when grantor+actor match', () => {
    ds.grantDelegation({
      delegator_user_id: 'user-1',
      delegate_email: 'agent-client-id',
      scopes: [],
    });
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'user-1');
    expect(result).not.toBeNull();
    expect(result.delegator_user_id).toBe('user-1');
    expect(result.status).toBe('active');
  });

  it('returns null when no active record exists', () => {
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'unknown-user');
    expect(result).toBeNull();
  });

  it('returns null after the record is revoked', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-2',
      delegate_email: 'agent-client-id',
      scopes: [],
    });
    ds.revokeDelegation(id);
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'user-2');
    expect(result).toBeNull();
  });
});

describe('grantDelegation with access_token', () => {
  it('stores access_token field on the record', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-3',
      delegate_email: 'agent-id',
      scopes: [],
      access_token: 'tok-abc',
    });
    const record = ds.getDelegationById(id);
    expect(record.access_token).toBe('tok-abc');
  });

  it('stores null access_token when not provided', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-4',
      delegate_email: 'agent-id',
      scopes: [],
    });
    const record = ds.getDelegationById(id);
    expect(record.access_token).toBeNull();
  });
});
