'use strict';

// PingFederate's PingOne user gate. The contract in
// spiffe/pingfederate/pf-pingone-user-gate.json makes PingFederate refuse an
// exchange unless the PingOne account with the subject's username is enabled
// and its mayAct names the AI agent actor. That only means something if the
// BFF (a) names the same refusal reasons the contract emits, (b) writes the
// grant onto that PingOne account, and (c) can actually disable it.

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setMayActAttribute: jest.fn(async () => {}),
  makeRequest: jest.fn(async () => ({})),
}));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn(),
}));

const pingOneUserService = require('../services/pingOneUserService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const configStore = require('../services/configStore');
const { PF_USER_GATE_ERRORS, RFC8693_ERRORS } = require('../services/rfcCompliantErrorHandler');
const agentAuthRouter = require('../routes/agentAuthorization');
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
// Required here, not inside the test: the repo's global afterEach resets the
// module registry, so a later require would bind to a different mock instance.
const { disableUserAtPingOne } = require('../services/killSwitchService');

const contract = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'spiffe', 'pingfederate', 'pf-pingone-user-gate.json'), 'utf8',
));

describe('contract and BFF agree', () => {
  test('the BFF recognises exactly the refusal reasons the contract emits', () => {
    expect([...PF_USER_GATE_ERRORS].sort()).toEqual(contract.criteria.map((c) => c.errorResult).sort());
  });

  test('every refusal reason has a description, so it is never reported as a generic failure', () => {
    for (const reason of PF_USER_GATE_ERRORS) expect(RFC8693_ERRORS[reason]).toEqual(expect.any(String));
  });

  test('the lookup keys on the subject token\'s username and the grant on the agent actor', () => {
    // ${Username} alone is an unknown key to PingFederate: the lookup throws and
    // every exchange is refused (measured 2026-10-02).
    expect(contract.attributeSource.resourcePath).toContain('${subjecttoken.Username}');
    expect(contract.criteria.find((c) => c.attributeName === 'p1Enabled').value).toBe('true');
  });

  test('the grant rule names no particular agent', () => {
    // It compares the PingOne user's mayAct with the agent in the chain: the
    // actor token's client on the first exchange, the subject token's existing
    // act afterwards. A fixed agent id here would lock out every other agent a
    // user may grant (delegated commerce registers one per shopper).
    const grant = contract.criteria.find((c) => c.errorResult === 'agent_not_authorized_by_user');
    expect(grant.expression).toContain('ds.p1user.mayActSub');
    expect(grant.expression).toContain('actortoken.client_id');
    expect(grant.expression).toContain('subjecttoken.act');
    expect(grant.expression).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(grant).not.toHaveProperty('valueEnv');
  });
});

describe('agent grant and revoke under a PingFederate sign-in', () => {
  const pfSession = { oauthProvider: 'pingfederate', user: { username: 'demouser', oauthId: 'demouser' } };
  let getEffective;

  function buildApp(session) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'demouser' }; req.session = JSON.parse(JSON.stringify(session)); next(); });
    app.use('/api/agent-authorization', agentAuthRouter);
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getEffective = jest.spyOn(configStore, 'getEffective')
      .mockImplementation((key) => (key === 'ai_agent_client_id' ? 'agent-uuid' : null));
    fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid' }, error: null });
  });

  afterEach(() => {
    getEffective.mockRestore();
    for (const d of delegationStore.getDelegations('demouser')) {
      if (d.status === 'active') delegationStore.revokeDelegation(d.id);
    }
  });

  test('grant writes mayAct on the PingOne account with the same username', async () => {
    await request(buildApp(pfSession)).post('/api/agent-authorization/grant').expect(200);

    expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demouser');
    expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('p1-uuid', { sub: 'agent-uuid' });
  });

  test('revoke clears mayAct on that same account', async () => {
    await request(buildApp(pfSession)).post('/api/agent-authorization/revoke').expect(200);

    expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('p1-uuid', null);
  });

  test('no PingOne account: 409, and nothing is written under the PingFederate username', async () => {
    fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });

    const res = await request(buildApp(pfSession)).post('/api/agent-authorization/grant').expect(409);

    expect(res.body.error).toBe('pingone_user_not_linked');
    expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
  });
});

describe('kill switch user disable', () => {
  test('uses PUT /users/{id}/enabled — PingOne rejects PATCH {enabled:false} as immutable', async () => {
    await expect(disableUserAtPingOne('p1-uuid')).resolves.toEqual({ disabled: true });
    expect(pingOneUserService.makeRequest).toHaveBeenCalledWith('PUT', '/users/p1-uuid/enabled', { enabled: false });
  });
});
