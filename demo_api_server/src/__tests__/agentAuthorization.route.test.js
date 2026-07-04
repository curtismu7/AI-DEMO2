'use strict';
/** /api/agent-authorization grant/revoke/status */

jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const request = require('supertest');
const express = require('express');
const pingOneUserService = require('../../services/pingOneUserService');
const configStore = require('../../services/configStore');
// Require the router ONCE here so it binds to the same mock instances the
// assertions use. (The repo's global afterEach runs jest.resetModules(), so a
// re-require inside buildApp would bind to fresh, different mocks.)
const agentAuthRouter = require('../../routes/agentAuthorization');
// delegationStore is NOT mocked, so the GET /status test's real POST /grant
// writes to the shared on-disk LMDB. Require it here (same singleton the router
// uses) so afterEach can revoke leftover records — otherwise they leak into
// other suites (agentAuthorizationRevoke, pingoneTestRoutes).
const delegationStore = require('../../services/lmdb/delegationStore.lmdb');

function tokenWith(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}
function buildApp(session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'user-5' }; req.session = session; next(); });
  app.use('/api/agent-authorization', agentAuthRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
  pingOneUserService.setMayActAttribute.mockResolvedValue(undefined);
  configStore.getEffective.mockReturnValue(null);
});

afterEach(() => {
  // Revoke any delegation the GET /status test's real POST /grant wrote, so the
  // shared LMDB store doesn't pollute other suites.
  for (const d of delegationStore.getDelegations('user-5')) {
    if (d.status === 'active') delegationStore.revokeDelegation(d.id);
  }
});

test('POST /grant writes mayAct={sub: ai_agent_client_id} and signals reauth', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'ai_agent_client_id' ? 'agent-uuid' : null));
  const res = await request(buildApp()).post('/api/agent-authorization/grant').expect(200);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-5', { sub: 'agent-uuid' });
  expect(res.body).toEqual({ ok: true, reauthRequired: true });
});

test('POST /grant → 503 when agent client id not configured', async () => {
  configStore.getEffective.mockReturnValue(null);
  const res = await request(buildApp()).post('/api/agent-authorization/grant').expect(503);
  expect(res.body.error).toBe('agent_not_configured');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
});

test('POST /revoke clears mayAct and signals reauth', async () => {
  const res = await request(buildApp()).post('/api/agent-authorization/revoke').expect(200);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-5', null);
  expect(res.body).toEqual({ ok: true, reauthRequired: true });
});

test('GET /status authorized=true when an active LMDB delegation record exists; enforced from flag', async () => {
  // Status no longer trusts the JWT may_act claim — it checks the LMDB
  // delegation record (see routes/agentAuthorization.js GET /status and
  // commit c6c6dbc43 "fix(agent-revocation): ... Status endpoint checks
  // LMDB record via delegationStore, not JWT may_act claim").
  configStore.getEffective.mockImplementation((k) => {
    if (k === 'ff_require_may_act') return 'true';
    if (k === 'ai_agent_client_id') return 'agent-uuid';
    return null;
  });
  const session = { oauthTokens: { accessToken: tokenWith({ may_act: { sub: 'agent-uuid' } }) } };
  const app = buildApp(session);
  await request(app).post('/api/agent-authorization/grant').expect(200);
  const res = await request(app).get('/api/agent-authorization/status').expect(200);
  expect(res.body).toEqual({ authorized: true, enforced: true });
});

test('GET /status authorized=false when the token has no may_act', async () => {
  configStore.getEffective.mockReturnValue(null);
  const session = { oauthTokens: { accessToken: tokenWith({ sub: 'user-5' }) } };
  const res = await request(buildApp(session)).get('/api/agent-authorization/status').expect(200);
  expect(res.body).toEqual({ authorized: false, enforced: false });
});

test('POST /grant → 502 when the PingOne write fails', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'ai_agent_client_id' ? 'agent-uuid' : null));
  pingOneUserService.setMayActAttribute.mockRejectedValueOnce(new Error('boom'));
  const res = await request(buildApp()).post('/api/agent-authorization/grant').expect(502);
  expect(res.body.error).toBe('mayact_write_failed');
});
