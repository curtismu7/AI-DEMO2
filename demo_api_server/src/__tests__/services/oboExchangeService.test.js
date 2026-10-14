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
