'use strict';

// Live (PAR) intent-binding: the PERMIT/DENY comes from this backend's amount <= cap
// comparison; PingOne's PAR endpoint only stores the request. The event label must not
// claim PingOne Authorize decided it.
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.session = req.session || {}; next(); },
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'pingone_ai_agent_actor_client_id') return 'actor-client';
    if (key === 'pingone_ai_agent_actor_client_secret') return 'actor-secret';
    return '';
  }),
  setRaw: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/sidecarClientRelay', () => ({ manages: jest.fn().mockResolvedValue(false) }));
jest.mock('../../services/attackSimulatorService', () => ({ runIntentBindingDemo: jest.fn() }));
jest.mock('../../services/oauthEndpointResolver', () => ({ getParEndpoint: () => 'https://auth.example/par' }));
jest.mock('../../services/oauthRedirectUris', () => ({ listActorParRedirectCandidates: () => ['https://app.example/cb'] }));
jest.mock('../../services/parService', () => ({
  isParRedirectUriMismatch: () => false,
  pushAuthorizationRequestWithRedirectFallback: jest.fn().mockResolvedValue({
    requestUri: 'urn:ietf:params:oauth:request_uri:abc',
    redirectUri: 'https://app.example/cb',
    expiresIn: 60,
    usedFallback: false,
  }),
}));

const express = require('express');
const request = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/demo/intent-binding', require('../../routes/intentBinding'));
  return a;
}

describe('POST /api/demo/intent-binding/run live PAR labels', () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = OLD_ENV; });

  test('live PERMIT names the app-side amount check, not PingOne Authorize', async () => {
    const res = await request(app()).post('/api/demo/intent-binding/run')
      .send({ action: 'permit', requestedAmount: 80, live: true });
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(res.body.sim).toBe('par-permit');
    const permit = res.body.tokenChainEvents.find((e) => e.id === 'p1az-permit');
    expect(permit).toBeTruthy();
    expect(permit.label).not.toMatch(/PingOne Authorize/);
    expect(permit.label).toMatch(/Amount check — PERMIT/);
    expect(res.body.decisionEngine).toBe('app-intent-cap-check');
  });

  test('no live-run event or reason claims PingOne Authorize decided', async () => {
    const res = await request(app()).post('/api/demo/intent-binding/run')
      .send({ action: 'drift', requestedAmount: 500, live: true });
    expect(res.status).toBe(200);
    expect(res.body.sim).toBe('par-deny');
    const text = JSON.stringify({ reason: res.body.reason, ev: res.body.tokenChainEvents });
    expect(text).not.toMatch(/PingOne Authorize/);
    expect(res.body.decisionEngine).toBe('app-intent-cap-check');
  });
});
