'use strict';

jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));

const { validateToken } = require('../services/tokenValidationService');
const { verifyA2aBearer, A2aAuthError } = require('../middleware/a2aPingOneBearer');

// 'investment' is a real specialist (config/a2aSpecialists.js) with appKey 'holdings'.
const VERTICAL = 'investment';
const GENERALIST = 'generalist-client-id';
const AUD = 'https://a2a-intermediate.investment.example';

// Minimal configStore fake: only getEffective is read by resolveA2aConfig and the validator.
function fakeCfg(overrides = {}) {
  const values = {
    pingone_ai_agent_client_id: GENERALIST,
    a2a_intermediate_audience_holdings: AUD,
    a2a_gateway_audience: 'https://a2a-gateway.example',
    pingone_holdings_agent_client_id: 'specialist-client-id',
    pingone_holdings_agent_client_secret: 'shh',
    ...overrides,
  };
  return { getEffective: (k) => values[k] || '' };
}

const GOOD_CLAIMS = {
  sub: 'user-123',
  aud: [AUD],
  scope: 'agent:invoke:holdings invest:read',
  act: { client_id: GENERALIST },
};

function run(claims, cfg = fakeCfg()) {
  validateToken.mockResolvedValueOnce(claims);
  return verifyA2aBearer('header.payload.sig', { vertical: VERTICAL, cfg });
}

async function expectRejection(claims, { code, status, challenge }, cfg) {
  const expected = { code, status };
  if (challenge) expected.challenge = challenge;
  await expect(run(claims, cfg)).rejects.toMatchObject(expected);
  await expect(run(claims, cfg)).rejects.toBeInstanceOf(A2aAuthError);
}

const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

describe('verifyA2aBearer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts a delegated token for this specialist and returns its claims', async () => {
    const claims = await run(GOOD_CLAIMS);
    expect(claims.sub).toBe('user-123');
  });

  test('rejects a token that fails PingOne signature verification', async () => {
    validateToken.mockRejectedValueOnce(new Error('signature verification failed'));
    await expect(
      verifyA2aBearer('bad.token.sig', { vertical: VERTICAL, cfg: fakeCfg() }),
    ).rejects.toMatchObject({ code: 'invalid_token', status: 401, challenge: INVALID_TOKEN_CHALLENGE });
  });

  test('rejects a token audienced to a DIFFERENT specialist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, aud: ['https://a2a-intermediate.tax.example'] },
      { code: 'invalid_token', status: 401, challenge: INVALID_TOKEN_CHALLENGE },
    );
  });

  test('rejects a token missing the agent:invoke scope for this specialist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, scope: 'invest:read' },
      { code: 'insufficient_scope', status: 403 },
    );
  });

  test('rejects a bare client_credentials token (no act, so no user behind it)', async () => {
    const { act, ...noAct } = GOOD_CLAIMS;
    await expectRejection(noAct, { code: 'invalid_token', status: 401, challenge: INVALID_TOKEN_CHALLENGE });
  });

  test('rejects an Exchange #2 token replayed into the hop (act nested two deep)', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, act: { client_id: 'specialist-client-id', act: { client_id: GENERALIST } } },
      { code: 'invalid_token', status: 401, challenge: INVALID_TOKEN_CHALLENGE },
    );
  });

  test('rejects an actor that is not the generalist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, act: { client_id: 'some-other-agent' } },
      { code: 'invalid_token', status: 401, challenge: INVALID_TOKEN_CHALLENGE },
    );
  });

  test('falls back to act.sub when PingOne omits act.client_id', async () => {
    const claims = await run({ ...GOOD_CLAIMS, act: { sub: GENERALIST } });
    expect(claims.sub).toBe('user-123');
  });

  test('carries a WWW-Authenticate challenge and leaks no reason to the client', async () => {
    validateToken.mockResolvedValueOnce({ ...GOOD_CLAIMS, scope: 'invest:read' });
    const err = await verifyA2aBearer('t.t.t', { vertical: VERTICAL, cfg: fakeCfg() }).catch((e) => e);
    expect(err.challenge).toBe(
      'Bearer error="insufficient_scope", scope="agent:invoke:holdings"',
    );
    expect(err.logDetail).toMatch(/scope/i);
    expect(err.message).not.toMatch(/agent:invoke/);
  });
});
