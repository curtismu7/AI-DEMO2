'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { exchangeForThirdPartyAccessToken } = require('../../services/pfAiAgentCrossDomainExchangeService');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'pf-id-jag-signing-key';
jwk.use = 'sig';
jwk.alg = 'RS256';
const idJag = jwt.sign({
  iss: 'https://pf.example.test',
  aud: 'https://downstream.example.test',
  sub: 'agent-user-100',
  scope: 'accounts:read',
  resource: 'https://downstream.example.test/accounts',
  exp: Math.floor(Date.now() / 1000) + 300,
}, privateKey, { algorithm: 'RS256', keyid: jwk.kid });

function makeStore(overrides = {}) {
  const values = {
    pf_issuer: 'https://pf.example.test',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_ai_cross_domain_enabled: 'true',
    pf_ai_cross_domain_client_id: 'pf-id-jag-client',
    pf_ai_cross_domain_client_secret: 'pf-secret',
    pf_ai_cross_domain_token_endpoint_auth_method: 'basic',
    pf_ai_cross_domain_audience: 'https://downstream.example.test',
    pf_ai_cross_domain_resource: 'https://downstream.example.test/accounts',
    pf_ai_cross_domain_scope: 'accounts:read',
    pf_ai_third_party_token_endpoint: 'https://downstream.example.test/token',
    pf_ai_third_party_client_id: 'downstream-jwt-bearer-client',
    pf_ai_third_party_client_secret: 'downstream-secret',
    pf_ai_third_party_token_endpoint_auth_method: 'post',
    pf_ai_third_party_resource: 'https://downstream.example.test/accounts',
    pf_ai_third_party_scope: 'accounts:read',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function responseSequence() {
  return jest.fn()
    .mockResolvedValueOnce(jsonResponse({
      access_token: idJag,
      issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
      token_type: 'N_A',
      expires_in: 240,
    }))
    .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }))
    .mockResolvedValueOnce(jsonResponse({
      access_token: 'downstream-access-token',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'accounts:read',
    }));
}

describe('PF AI Agent cross-domain exchange', () => {
  test('issues a PF ID-JAG and redeems it at the configured third-party authorization server', async () => {
    const fetchImpl = responseSequence();
    const req = { session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } } };

    const result = await exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingone', store: makeStore(), fetchImpl,
    });

    expect(result).toEqual(expect.objectContaining({
      subjectProvider: 'pingone',
      pfIssuer: 'https://pf.example.test',
      assertionAudience: 'https://downstream.example.test',
      downstreamIssuer: 'https://downstream.example.test',
      downstreamAudience: 'https://downstream.example.test/accounts',
      subject: 'agent-user-100',
      scope: ['accounts:read'],
      hops: expect.arrayContaining([expect.objectContaining({ issuer: 'https://pf.example.test' })]),
    }));
    const pfBody = fetchImpl.mock.calls[0][1].body;
    expect(pfBody.get('requested_token_type')).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(pfBody.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(pfBody.get('subject_token')).toBe('p1-session-token');
    const downstreamBody = fetchImpl.mock.calls[2][1].body;
    expect(downstreamBody.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(downstreamBody.get('assertion')).toBe(idJag);
    expect(JSON.stringify(result)).not.toMatch(/p1-session-token|downstream-access-token|eyJ/);
  });

  test('records the exchange as proof: the decoded ID-JAG, what was verified and the redemption, with no secret in it', async () => {
    const fetchImpl = responseSequence();
    const req = { session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } } };

    const result = await exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingone', store: makeStore(), fetchImpl,
    });

    expect(result.trace.map((step) => step.id)).toEqual(['pf-exchange', 'verify', 'redeem']);
    const [pfStep, verifyStep, redeemStep] = result.trace;
    expect(pfStep.request.params).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
      audience: 'https://downstream.example.test',
    });
    expect(pfStep.request.params.subject_token).toMatch(/^<redacted/);
    expect(pfStep.response.body.access_token).toMatch(/^<redacted JWT/);
    expect(pfStep.claims.idJag).toMatchObject({
      iss: 'https://pf.example.test', aud: 'https://downstream.example.test', sub: 'agent-user-100', scope: 'accounts:read',
    });
    expect(pfStep.claims.idJagHeader).toMatchObject({ alg: 'RS256', kid: jwk.kid });
    expect(verifyStep.note).toMatch(/Signature verified .*issuer https:\/\/pf\.example\.test/);
    expect(redeemStep.request.params.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(redeemStep.request.params.assertion).toMatch(/^<redacted JWT/);
    expect(redeemStep.request.params.client_secret).toMatch(/^<redacted/);
    const text = JSON.stringify(result);
    for (const secret of [idJag, 'p1-session-token', 'downstream-secret', 'downstream-access-token']) {
      expect(text).not.toContain(secret);
    }
  });

  test('says in the proof when the subject token was the CIMD sign-in, not the PingOne session', async () => {
    const fetchImpl = responseSequence();
    const req = {
      session: {
        oauthProvider: 'pingone',
        oauthTokens: { accessToken: 'p1-session-token' },
        pfAiAgent: { cimdTokens: { accessToken: 'pf-cimd-token', expiresAt: Date.now() + 60000 } },
      },
    };

    const result = await exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
    });

    expect(result.trace[0].note).toMatch(/CIMD sign-in/);
    expect(JSON.stringify(result)).not.toContain('pf-cimd-token');
  });

  describe('a PingFederate sign-in made through the CIMD flow while the app session is PingOne', () => {
    const p1Session = (cimdTokens) => ({
      session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' }, pfAiAgent: { cimdTokens } },
    });

    test('exchanges the CIMD PingFederate token, never the PingOne one', async () => {
      const fetchImpl = responseSequence();
      await exchangeForThirdPartyAccessToken(
        p1Session({ accessToken: 'pf-cimd-token', expiresAt: Date.now() + 60000 }),
        { subjectProvider: 'pingfederate', store: makeStore(), fetchImpl },
      );
      const pfBody = fetchImpl.mock.calls[0][1].body;
      expect(pfBody.get('subject_token')).toBe('pf-cimd-token');
      expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('p1-session-token');
    });

    test.each([
      ['no CIMD sign-in', undefined],
      ['an expired one', { accessToken: 'pf-cimd-token', expiresAt: Date.now() - 1000 }],
      ['a DPoP-bound one (the exchange cannot present the key)', { accessToken: 'pf-cimd-token', dpopJkt: 'thumb' }],
    ])('is refused with %s', async (_label, cimdTokens) => {
      const fetchImpl = jest.fn();
      await expect(exchangeForThirdPartyAccessToken(p1Session(cimdTokens), {
        subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
      })).rejects.toMatchObject({ code: 'PF_AI_SUBJECT_PROVIDER_MISMATCH', httpStatus: 403 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  test('rejects a PingOne token when PingFederate is selected as the source without making an outbound call', async () => {
    const fetchImpl = jest.fn();
    const req = { session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } } };

    await expect(exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_SUBJECT_PROVIDER_MISMATCH', httpStatus: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ['a different issuer', { iss: 'https://evil.example.test' }, 'PF_AI_ID_JAG_ISSUER_INVALID'],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 60 }, 'PF_AI_ID_JAG_EXPIRED'],
    ['a scope that was not asked for', { scope: 'accounts:write' }, 'PF_AI_ID_JAG_SCOPE_MISMATCH'],
    ['a resource that was not asked for', { resource: 'https://other.example.test/accounts' }, 'PF_AI_ID_JAG_RESOURCE_MISMATCH'],
    ['no subject', { sub: undefined }, 'PF_AI_ID_JAG_CLAIMS_INVALID'],
  ])('names the cause when the ID-JAG has %s', async (_label, override, code) => {
    const claims = {
      iss: 'https://pf.example.test',
      aud: 'https://downstream.example.test',
      sub: 'agent-user-100',
      scope: 'accounts:read',
      resource: 'https://downstream.example.test/accounts',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...override,
    };
    const badIdJag = jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: jwk.kid });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: badIdJag,
        issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' }))
      .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));
    const req = { session: { oauthProvider: 'pingfederate', oauthTokens: { accessToken: 'pf-session-token' } } };

    await expect(exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('says so when PingFederate does not recognize the session token issuer (a PingOne token)', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse(
      { error: 'invalid_request', error_description: 'The issuer was not recognized.' }, 400));
    const req = { session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } } };

    await expect(exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingone', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_SUBJECT_ISSUER_NOT_RECOGNIZED', httpStatus: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('any other upstream refusal is still the generic code', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, 500));
    const req = { session: { oauthProvider: 'pingfederate', oauthTokens: { accessToken: 'pf-session-token' } } };

    await expect(exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_UPSTREAM_REJECTED', httpStatus: 502 });
  });

  test('rejects an ID-JAG with a different audience before calling the downstream AS', async () => {
    const badIdJag = jwt.sign({
      iss: 'https://pf.example.test',
      aud: 'https://other.example.test',
      sub: 'agent-user-100',
      scope: 'accounts:read',
      resource: 'https://downstream.example.test/accounts',
      exp: Math.floor(Date.now() / 1000) + 300,
    }, privateKey, { algorithm: 'RS256', keyid: jwk.kid });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: badIdJag,
        issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' }))
      .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));
    const req = { session: { oauthProvider: 'pingfederate', oauthTokens: { accessToken: 'pf-session-token' } } };

    await expect(exchangeForThirdPartyAccessToken(req, {
      subjectProvider: 'pingfederate', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_ID_JAG_AUDIENCE_INVALID' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
