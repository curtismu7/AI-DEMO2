'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { beginRar, completeRar } = require('../services/pfAiAgentRarService');
const { generateDpopKeypair } = require('../services/dpopKeyService');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const TOKEN_ENDPOINT = 'https://pf.example.test/as/token.oauth2';
const PLAIN_CLIENT = 'ai-demo-pf-rar';
const DPOP_CLIENT = 'ai-demo-pf-rar-dpop';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pf-key', use: 'sig', alg: 'RS256' };

function makeStore(overrides = {}) {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_ai_rar_enabled: 'true',
    pf_ai_rar_client_id: PLAIN_CLIENT,
    pf_ai_rar_dpop_client_id: DPOP_CLIENT,
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: TOKEN_ENDPOINT,
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_par_endpoint: 'https://pf.example.test/as/par.oauth2',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const json = (data, status = 200, nonce = null) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  headers: { get: (name) => (String(name).toLowerCase() === 'dpop-nonce' ? nonce : null) },
});
const discovery = () => json({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  pushed_authorization_request_endpoint: 'https://pf.example.test/as/par.oauth2',
});
const idToken = (clientId) => jwt.sign(
  { sub: 'demouser', nonce: 'no', iss: 'https://pf.example.test', aud: clientId },
  privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 },
);
const tokenOk = (clientId, tokenType) => json({
  id_token: idToken(clientId), access_token: 'at-secret-value', token_type: tokenType, expires_in: 300, scope: 'openid',
});

function pendingSession(overrides = {}) {
  const dpopKey = generateDpopKeypair();
  return {
    dpopKey,
    session: {
      pfAiAgent: {
        rarPending: {
          state: 'st', nonce: 'no', verifier: 'verifier-secret', createdAt: Date.now(), expiresAt: Date.now() + 300_000,
          scenario: 'allowed', userKey: 'demouser', clientId: DPOP_CLIENT, dpopKey, ...overrides,
        },
      },
    },
  };
}
const callback = { state: 'st', code: 'auth-code' };
const proofOf = (fetchImpl, callIndex = 1) => fetchImpl.mock.calls[callIndex][1].headers.DPoP;

describe('RAR with a DPoP-bound token', () => {
  test('signs a genuine DPoP proof for the token request and reports the bound key', async () => {
    const { session, dpopKey } = pendingSession();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(tokenOk(DPOP_CLIENT, 'DPoP'))
      .mockResolvedValueOnce(json({ keys: [jwk] }));

    const result = await completeRar({ session, query: callback }, { store: makeStore(), fetchImpl });

    expect(fetchImpl.mock.calls[1][1].body.get('client_id')).toBe(DPOP_CLIENT);
    const proof = proofOf(fetchImpl);
    const { header, payload } = jwt.decode(proof, { complete: true });
    expect(header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256' });
    expect(header.jwk).toEqual({
      kty: dpopKey.publicJwk.kty, crv: dpopKey.publicJwk.crv, x: dpopKey.publicJwk.x, y: dpopKey.publicJwk.y,
    });
    // Genuine: it verifies with the very key it carries.
    expect(() => jwt.verify(proof, crypto.createPublicKey({ key: header.jwk, format: 'jwk' }), { algorithms: ['ES256'] })).not.toThrow();
    expect(payload).toMatchObject({ htm: 'POST', htu: TOKEN_ENDPOINT });
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty('nonce');
    expect(result).toMatchObject({ outcome: 'accepted', tokenType: 'DPoP', dpopThumbprint: dpopKey.jkt });
  });

  test('never lets a token, a code, a verifier or the private key into the result', async () => {
    const { session } = pendingSession();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(tokenOk(DPOP_CLIENT, 'DPoP'))
      .mockResolvedValueOnce(json({ keys: [jwk] }));
    const result = await completeRar({ session, query: callback }, { store: makeStore(), fetchImpl });
    expect(JSON.stringify(result)).not.toMatch(/at-secret-value|auth-code|verifier-secret|PRIVATE KEY|"d":/);
    expect(JSON.stringify(session.pfAiAgent.rarResult)).not.toMatch(/PRIVATE KEY|at-secret-value/);
    expect(session.pfAiAgent.rarPending).toBeUndefined();
  });

  test('signs again with the nonce PingFederate demands, exactly once', async () => {
    const { session } = pendingSession();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(json({ error: 'use_dpop_nonce' }, 400, 'server-nonce-1'))
      .mockResolvedValueOnce(tokenOk(DPOP_CLIENT, 'DPoP'))
      .mockResolvedValueOnce(json({ keys: [jwk] }));

    const result = await completeRar({ session, query: callback }, { store: makeStore(), fetchImpl });

    expect(result.tokenType).toBe('DPoP');
    expect(jwt.decode(proofOf(fetchImpl, 1)).nonce).toBeUndefined();
    expect(jwt.decode(proofOf(fetchImpl, 2)).nonce).toBe('server-nonce-1');
  });

  test('does not keep retrying when PingFederate keeps refusing', async () => {
    const { session } = pendingSession();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValue(json({ error: 'use_dpop_nonce' }, 400, 'server-nonce-1'));

    await expect(completeRar({ session, query: callback }, { store: makeStore(), fetchImpl }))
      .rejects.toMatchObject({ code: 'PF_AI_TOKEN_EXCHANGE_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // discovery + the request + one retry
  });

  test('refuses a plain Bearer token when binding was asked for', async () => {
    const { session } = pendingSession();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(tokenOk(DPOP_CLIENT, 'Bearer'));
    await expect(completeRar({ session, query: callback }, { store: makeStore(), fetchImpl }))
      .rejects.toMatchObject({ code: 'PF_AI_DPOP_NOT_BOUND' });
  });

  test('a run without DPoP sends no proof and reports a plain token', async () => {
    const { session } = pendingSession({ clientId: PLAIN_CLIENT, dpopKey: null });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(tokenOk(PLAIN_CLIENT, 'Bearer'))
      .mockResolvedValueOnce(json({ keys: [jwk] }));
    const result = await completeRar({ session, query: callback }, { store: makeStore(), fetchImpl });
    expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty('DPoP');
    expect(result).toMatchObject({ tokenType: 'Bearer', dpopThumbprint: null });
  });
});

describe('starting a DPoP run', () => {
  const req = () => ({ session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 't' }, user: { username: 'demouser' } } });
  const parFetch = () => jest.fn()
    .mockResolvedValueOnce(discovery())
    .mockResolvedValueOnce(json({ request_uri: 'urn:ietf:params:oauth:request_uri:opaque', expires_in: 90 }));

  test('uses the DPoP client and keeps a fresh key with the pending flow', async () => {
    const request = req();
    const fetchImpl = parFetch();
    const { redirectUrl } = await beginRar(request, { scenario: 'allowed', dpop: true, store: makeStore(), fetchImpl });

    expect(fetchImpl.mock.calls[1][1].body.get('client_id')).toBe(DPOP_CLIENT);
    expect(new URL(redirectUrl).searchParams.get('client_id')).toBe(DPOP_CLIENT);
    const pending = request.session.pfAiAgent.rarPending;
    expect(pending.clientId).toBe(DPOP_CLIENT);
    expect(pending.dpopKey).toMatchObject({ jkt: expect.any(String) });
    expect(pending.dpopKey.privatePem).toContain('PRIVATE KEY');
    expect(JSON.stringify({ redirectUrl })).not.toContain('PRIVATE KEY');
  });

  test('a normal run keeps the normal client and no key', async () => {
    const request = req();
    await beginRar(request, { scenario: 'allowed', store: makeStore(), fetchImpl: parFetch() });
    const pending = request.session.pfAiAgent.rarPending;
    expect(pending.clientId).toBe(PLAIN_CLIENT);
    expect(pending.dpopKey).toBeNull();
  });

  test('refuses DPoP, without calling PingFederate, when no DPoP client is configured', async () => {
    const fetchImpl = jest.fn();
    await expect(beginRar(req(), {
      scenario: 'allowed', dpop: true, store: makeStore({ pf_ai_rar_dpop_client_id: '' }), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_RAR_DPOP_NOT_CONFIGURED', httpStatus: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
