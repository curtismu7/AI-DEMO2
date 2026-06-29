'use strict';
const express = require('express');
const request = require('supertest');

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'ai_agent_client_id') return 'agent-client-id';
    if (key === 'pingone_client_id') return 'client-id';
    if (key === 'pingone_client_secret') return 'client-secret';
    if (key === 'ff_require_may_act') return false;
    return null;
  }),
}));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  grantDelegation: jest.fn().mockReturnValue({ id: 'delegation-id-1' }),
  findActiveByActorAndGrantor: jest.fn(),
  revokeDelegation: jest.fn(),
}));
jest.mock('../services/tokenRevocation', () => ({
  revokeToken: jest.fn().mockResolvedValue(true),
}));

// These are re-assigned in beforeEach because the global afterEach calls
// jest.resetModules(), which clears the module registry and creates fresh
// mock instances. Without re-requiring here the top-level references would
// point to stale mock objects that the route no longer shares.
let delegationStore;
let revokeToken;

beforeEach(() => {
  delegationStore = require('../services/lmdb/delegationStore.lmdb');
  ({ revokeToken } = require('../services/tokenRevocation'));
});

function makeApp(session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'user@example.com' };
    req.session = { oauthTokens: { accessToken: 'access-tok', ...session } };
    next();
  });
  app.use('/api/agent-authorization', require('../routes/agentAuthorization'));
  return app;
}

describe('POST /api/agent-authorization/grant writes LMDB', () => {
  it('calls grantDelegation with delegator_user_id and delegate_email', async () => {
    const res = await request(makeApp()).post('/api/agent-authorization/grant');
    expect(res.status).toBe(200);
    expect(delegationStore.grantDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        delegator_user_id: 'user-1',
        delegate_email: 'agent-client-id',
      })
    );
  });
});

describe('DELETE /api/agent-authorization (soft revoke)', () => {
  it('returns 404 when no active delegation exists', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_active_delegation');
  });

  it('revokes the delegation and returns soft', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-1' });
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'soft' });
    expect(delegationStore.revokeDelegation).toHaveBeenCalledWith('del-1');
  });
});

describe('DELETE /api/agent-authorization/hard (hard revoke)', () => {
  it('returns 404 when no active delegation', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(404);
  });

  it('revokes delegation, calls revokeToken, returns sessionClear', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-2' });
    revokeToken.mockResolvedValue(true);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'hard', sessionClear: true });
    expect(revokeToken).toHaveBeenCalledWith('access-tok', 'access_token', 'client-id', 'client-secret');
  });

  it('still returns sessionClear even if revokeToken throws', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-3' });
    revokeToken.mockRejectedValue(new Error('network error'));
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body.sessionClear).toBe(true);
  });
});
