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
    return null;
  }),
}));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  grantDelegation: jest.fn().mockReturnValue({ id: 'delegation-id-1' }),
  findActiveByActorAndGrantor: jest.fn(),
}));
jest.mock('../services/delegationService', () => ({
  revokeDelegation: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('../services/tokenRevocation', () => ({
  revokeToken: jest.fn().mockResolvedValue(true),
}));

// These are re-assigned in beforeEach because the global afterEach calls
// jest.resetModules(), which clears the module registry and creates fresh
// mock instances. Without re-requiring here the top-level references would
// point to stale mock objects that the route no longer shares.
let delegationStore;
let delegationService;
let revokeToken;

beforeEach(() => {
  // resetModules() does NOT hand back fresh jest.fn()s here — the mock registry
  // outlives it, so call counts accumulated across every test in the file and
  // the two "exactly 11 calls" assertions below read 14 and 25 instead. Clear
  // usage data explicitly. mockClear keeps the implementations the jest.mock
  // factories installed (mockResolvedValue / the getEffective mapping), so only
  // calls/instances/results are reset — see [[jest-resetmodules-stale-mock-handles]].
  jest.clearAllMocks();
  delegationStore = require('../services/lmdb/delegationStore.lmdb');
  delegationService = require('../services/delegationService');
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
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).post('/api/agent-authorization/grant');
    expect(res.status).toBe(200);
    expect(delegationStore.grantDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        delegator_user_id: 'user-1',
        delegate_email: 'agent-client-id',
      })
    );
  });

  it('skips grantDelegation when an active record already exists', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'existing-del' });
    delegationStore.grantDelegation.mockClear();
    const res = await request(makeApp()).post('/api/agent-authorization/grant');
    expect(res.status).toBe(200);
    expect(delegationStore.grantDelegation).not.toHaveBeenCalled();
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
    delegationStore.findActiveByActorAndGrantor
      .mockReturnValueOnce({ id: 'del-1' })
      .mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'soft' });
    expect(delegationService.revokeDelegation).toHaveBeenCalledWith('del-1', 'user-1');
  });
});

describe('DELETE /api/agent-authorization/hard (hard revoke)', () => {
  it('returns 404 when no active delegation', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(404);
  });

  it('revokes delegation, calls revokeToken, returns sessionClear', async () => {
    delegationStore.findActiveByActorAndGrantor
      .mockReturnValueOnce({ id: 'del-2' })
      .mockReturnValue(null);
    revokeToken.mockResolvedValue(true);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'hard', sessionClear: true });
    expect(delegationService.revokeDelegation).toHaveBeenCalledWith('del-2', 'user-1');
    expect(revokeToken).toHaveBeenCalledWith('access-tok', 'access_token', 'client-id', 'client-secret');
  });

  it('still returns sessionClear even if revokeToken throws', async () => {
    delegationStore.findActiveByActorAndGrantor
      .mockReturnValueOnce({ id: 'del-3' })
      .mockReturnValue(null);
    revokeToken.mockRejectedValue(new Error('network error'));
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body.sessionClear).toBe(true);
  });
});

// Regression guard: if revokeDelegation's failure means a record's status
// never actually flips, findActiveByActorAndGrantor keeps returning the SAME
// still-active record forever. Before the fix, both cleanup while-loops had
// no attempt cap and would spin indefinitely on a record that never clears.
// MAX_REVOKE_ATTEMPTS in routes/agentAuthorization.js is 10; expect 1 initial
// revoke + 10 retry-loop revokes = 11 total calls, then a terminated response.
describe('agentAuthorization revoke loops are bounded (no infinite spin)', () => {
  it('DELETE /hard gives up after the attempt cap and reports ok:false with a warning', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'stuck-del' }); // never clears
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.revoked).toBe('hard');
    expect(res.body.warning).toBeTruthy();
    expect(delegationService.revokeDelegation).toHaveBeenCalledTimes(11);
  }, 8000);

  it('DELETE / gives up after the attempt cap and returns 502 revoke_incomplete', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'stuck-del-2' }); // never clears
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('revoke_incomplete');
    expect(delegationService.revokeDelegation).toHaveBeenCalledTimes(11);
  }, 8000);
});
