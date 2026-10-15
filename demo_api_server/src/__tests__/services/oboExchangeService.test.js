'use strict';
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: jest.fn(() => ({
    audience: 'obo-demo.ping.demo', scope: 'obo:invoke', actorScope: 'agent:invoke',
    exchanger: { id: 'ex', secret: 'exs' }, agent: { id: 'AGENT', secret: 'ags' },
  })),
}));
jest.mock('../../../services/agentCCTokenService', () => ({ getAgentCCToken: jest.fn() }));
jest.mock('../../../services/oauthEndpointResolver', () => ({ getPingOneTokenEndpoint: jest.fn(() => 'https://pingone/as/token') }));
jest.mock('../../../services/oauthService', () => ({ performTokenExchangeAs: jest.fn() }));

const { getOboConfig } = require('../../../services/oboConfig');
const { runObo } = require('../../../services/oboExchangeService');

const jwt = (p) => ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(p)).toString('base64url'), 's'].join('.');
const user = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], client_id: 'c' });
const delegated = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', act: { client_id: 'AGENT' }, exp: 9999999999 });

const deps = (over = {}) => ({
  getActorToken: jest.fn().mockResolvedValue('actor'),
  exchange: jest.fn().mockResolvedValue(delegated),
  verifyDownstream: jest.fn(async (t) => (t === delegated ? { status: 200 } : { status: 401 })),
  ...over,
});

test('returns passing evidence and never the raw tokens', async () => {
  const d = deps();
  const ev = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d);
  expect(ev.checks.every((c) => c.pass)).toBe(true);
  expect(d.exchange).toHaveBeenCalledWith(user, 'actor', expect.objectContaining({ audience: 'obo-demo.ping.demo' }));
  expect(JSON.stringify(ev)).not.toContain(delegated);
  expect(JSON.stringify(ev)).not.toContain(user);
});

test('verifies BOTH tokens downstream', async () => {
  const d = deps();
  await runObo({ req: {}, subjectToken: user, source: 'page' }, d);
  expect(d.verifyDownstream).toHaveBeenCalledWith(delegated);
  expect(d.verifyDownstream).toHaveBeenCalledWith(user);
});

test('a downstream that accepts the user token produces a failing check', async () => {
  const d = deps({ verifyDownstream: jest.fn().mockResolvedValue({ status: 200 }) });
  const ev = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d);
  expect(ev.checks.find((c) => c.id === 'downstream-refuses-user').pass).toBe(false);
});

test('throws obo_not_configured (503) when the exchanger client is missing', async () => {
  getOboConfig.mockReturnValueOnce({ exchanger: {}, agent: { id: 'a', secret: 's' } });
  await expect(runObo({ req: {}, subjectToken: user, source: 'page' }, deps()))
    .rejects.toMatchObject({ code: 'obo_not_configured', httpStatus: 503 });
});

test('an exchange error propagates without the subject token in its message', async () => {
  const d = deps({ exchange: jest.fn().mockRejectedValue(new Error('Token exchange failed for ex: invalid_scope')) });
  const err = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d).catch((e) => e);
  expect(err.message).toMatch(/invalid_scope/);
  expect(err.message).not.toContain(user);
});

test('default exchange calls performTokenExchangeAs against the PingOne token endpoint only', async () => {
  // setup.js resets modules after each test, so load the service and its mocked deps from one fresh registry.
  const oauthService = require('../../../services/oauthService');
  const { runObo: freshRunObo } = require('../../../services/oboExchangeService');
  oauthService.performTokenExchangeAs.mockResolvedValue(delegated);
  const d = deps(); delete d.exchange;
  await freshRunObo({ req: {}, subjectToken: user, source: 'claude' }, d);
  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledWith(
    user, 'actor', 'ex', 'exs', 'obo-demo.ping.demo', 'obo:invoke', 'post', { tokenEndpoint: 'https://pingone/as/token' },
  );
});

describe('step trace for the page', () => {
  const ids = (ev) => ev.steps.map((s) => s.id);

  test('a good run returns 7 passing steps with timings and token-free facts', async () => {
    const ev = await runObo({ req: {}, subjectToken: user, source: 'page' }, deps());
    expect(ids(ev)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ev.steps.every((s) => s.status === 'pass' && typeof s.ms === 'number')).toBe(true);
    expect(ev.steps[0].facts).toMatchObject({ sub: 'u1', client_id: 'c' });
    expect(ev.steps[1].facts).toMatchObject({ client_id: 'AGENT', scope: 'agent:invoke' });
    expect(ev.steps[2].facts).toMatchObject({ audience: 'obo-demo.ping.demo', scope: 'obo:invoke', exchanger: 'ex' });
    expect(ev.steps[3].facts.delegated.act).toEqual({ client_id: 'AGENT' });
    expect(ev.steps[4].facts.status).toBe(200);
    expect(ev.steps[5].facts.status).toBe(401);
    expect(ev.steps[6].facts.leak).toBe(false);
    const text = JSON.stringify(ev.steps);
    expect(text).not.toContain(user);
    expect(text).not.toContain(delegated);
  });

  test('a downstream that accepts the user token fails step 6 only', async () => {
    const d = deps({ verifyDownstream: jest.fn().mockResolvedValue({ status: 200 }) });
    const ev = await runObo({ req: {}, subjectToken: user, source: 'page' }, d);
    expect(ev.steps.map((s) => s.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'pass']);
  });

  test('an exchange failure carries the partial trace: 1-2 pass, 3 fails with the PingOne reason, 4-7 skipped', async () => {
    const failure = Object.assign(new Error('Token exchange failed for ex: bad'), {
      httpStatus: 400, pingoneError: 'invalid_request', pingoneErrorDescription: "Not a valid access token for request param 'subject_token'",
    });
    const err = await runObo({ req: {}, subjectToken: user, source: 'page' }, deps({ exchange: jest.fn().mockRejectedValue(failure) })).catch((e) => e);
    expect(err.trace.map((s) => s.status)).toEqual(['pass', 'pass', 'fail', 'skip', 'skip', 'skip', 'skip']);
    expect(err.trace[2].facts).toMatchObject({ error: 'invalid_request', httpStatus: 400, description: expect.stringContaining('subject_token') });
  });

  test('an actor-token failure fails step 2 and skips the rest', async () => {
    const err = await runObo({ req: {}, subjectToken: user, source: 'page' }, deps({ getActorToken: jest.fn().mockRejectedValue(new Error('actor down')) })).catch((e) => e);
    expect(err.trace.map((s) => s.status)).toEqual(['pass', 'fail', 'skip', 'skip', 'skip', 'skip', 'skip']);
  });

  test('a PingOne description that contains a token is withheld from the trace', async () => {
    const failure = Object.assign(new Error('x'), { httpStatus: 400, pingoneError: 'invalid_request', pingoneErrorDescription: `bad token ${user}` });
    const err = await runObo({ req: {}, subjectToken: user, source: 'page' }, deps({ exchange: jest.fn().mockRejectedValue(failure) })).catch((e) => e);
    expect(JSON.stringify(err.trace)).not.toContain(user);
    expect(err.trace[2].facts.description).toMatch(/withheld/);
  });
});
