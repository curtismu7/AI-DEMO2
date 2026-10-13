'use strict';

// AIC token-exchange demo: the direct AIC sign-in (user token) and client credentials (actor token).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

jest.mock('../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://local.ping-devops.com:4000' }));

const aicDemo = require('../services/aicDemoService');

const ISSUER = 'https://tenant.example.com:443/am/oauth2/alpha';
const BASE = 'https://tenant.example.com:443/am/oauth2/alpha';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] };

const store = (overrides = {}) => ({
  getEffective: (key) => ({
    aic_issuer: ISSUER,
    aic_subject_client_id: 'aidemo2',
    aic_actor_client_id: 'agent',
    aic_actor_client_secret: 'agent-secret',
    aic_delegated_scope: 'repair',
    ...overrides,
  })[key],
});

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A stand-in AIC: discovery, JWKS, the token endpoint and introspection.
function fakeAic({ token = () => json(400, { error: 'invalid_request' }), introspect = () => json(200, { active: true }) } = {}) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/.well-known/openid-configuration')) {
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${BASE}/authorize`,
        token_endpoint: `${BASE}/access_token`,
        jwks_uri: `${BASE}/connect/jwk_uri`,
        introspection_endpoint: `${BASE}/introspect`,
      });
    }
    if (String(url).endsWith('/connect/jwk_uri')) return json(200, JWKS);
    if (String(url).endsWith('/introspect')) return introspect(init);
    return token(init);
  });
  return { fetchImpl, calls };
}

const idToken = (nonce) => jwt.sign({ sub: 'alice', nonce }, privateKey, {
  algorithm: 'RS256', keyid: 'k1', issuer: ISSUER, audience: 'aidemo2', expiresIn: 300,
});

describe('AIC demo: user token (direct AIC sign-in)', () => {
  test('signs in with PKCE on the public client and keeps the tokens out of the result', async () => {
    const req = { session: {}, query: {} };
    const start = fakeAic();
    const { redirectUrl } = await aicDemo.beginLogin(req, { store: store(), fetchImpl: start.fetchImpl });
    const authorize = new URL(redirectUrl);
    expect(authorize.pathname).toBe('/am/oauth2/alpha/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('aidemo2');
    expect(authorize.searchParams.get('scope')).toBe('openid profile email repair');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://local.ping-devops.com:4000/api/aic-demo/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');

    const { nonce, state } = req.session.aicDemo.pending;
    const finish = fakeAic({
      token: () => json(200, { access_token: 'opaque-user-token', id_token: idToken(nonce), scope: 'openid repair', expires_in: 3600 }),
      introspect: () => json(200, { active: false }),
    });
    req.query = { code: 'one-time-code', state };
    const identity = await aicDemo.completeLogin(req, { store: store(), fetchImpl: finish.fetchImpl });

    expect(identity.subject).toBe('alice');
    expect(req.session.aicDemo.userTokens.accessToken).toBe('opaque-user-token');
    expect(aicDemo.usable(req.session.aicDemo.userTokens)).toBe(true);
    // Public client: the code is redeemed with the verifier and no client secret.
    const redeem = finish.calls.find((c) => c.url.endsWith('/access_token'));
    expect(redeem.init.headers.Authorization).toBeUndefined();
    expect(redeem.init.body.get('code_verifier')).toBeTruthy();

    const shown = JSON.stringify(req.session.aicDemo.userResult);
    for (const secret of ['opaque-user-token', 'one-time-code', 'agent-secret', req.session.aicDemo.userTokens.idToken]) {
      expect(shown).not.toContain(secret);
    }
    expect(req.session.aicDemo.userResult.opaque).toBe(true);
    expect(req.session.aicDemo.userResult.trace.map((s) => s.id)).toEqual(['authorize', 'callback', 'token', 'introspect-user']);
    expect(req.session.aicDemo.userResult.trace[3].note).toMatch(/am-introspect-all-tokens/);
  });

  test('a callback with the wrong state is refused and clears the pending flow', async () => {
    const req = { session: {}, query: {} };
    await aicDemo.beginLogin(req, { store: store(), fetchImpl: fakeAic().fetchImpl });
    req.query = { code: 'c', state: 'not-the-state' };
    await expect(aicDemo.completeLogin(req, { store: store(), fetchImpl: fakeAic().fetchImpl }))
      .rejects.toMatchObject({ code: 'AIC_CALLBACK_INVALID' });
    expect(req.session.aicDemo.pending).toBeUndefined();
  });

  test("AIC's own error text is surfaced when it rejects the code", async () => {
    const req = { session: {}, query: {} };
    await aicDemo.beginLogin(req, { store: store(), fetchImpl: fakeAic().fetchImpl });
    req.query = { code: 'c', state: req.session.aicDemo.pending.state };
    const aic = fakeAic({ token: () => json(400, { error: 'redirect_uri_mismatch', error_description: 'The redirection URI provided does not match a pre-registered value.' }) });
    await expect(aicDemo.completeLogin(req, { store: store(), fetchImpl: aic.fetchImpl }))
      .rejects.toThrow(/redirect_uri_mismatch: The redirection URI provided/);
  });
});

describe('AIC demo: actor token (client credentials)', () => {
  test('authenticates as the confidential client and records a redacted trace', async () => {
    const req = { session: {} };
    const aic = fakeAic({
      token: () => json(200, { access_token: 'opaque-actor-token', scope: 'repair', expires_in: 3600, token_type: 'Bearer' }),
      introspect: () => json(200, { active: true, client_id: 'agent', scope: 'repair' }),
    });
    const result = await aicDemo.fetchActorToken(req, { store: store(), fetchImpl: aic.fetchImpl });

    const call = aic.calls.find((c) => c.url.endsWith('/access_token'));
    expect(call.init.headers.Authorization).toBe(`Basic ${Buffer.from('agent:agent-secret').toString('base64')}`);
    expect(call.init.body.get('grant_type')).toBe('client_credentials');
    expect(call.init.body.get('scope')).toBe('repair');
    expect(req.session.aicDemo.actorTokens.accessToken).toBe('opaque-actor-token');
    expect(result.trace.map((s) => s.id)).toEqual(['actor-token', 'introspect-actor']);
    expect(result.trace[1].response.body).toMatchObject({ active: true, client_id: 'agent' });
    const shown = JSON.stringify(result);
    expect(shown).not.toContain('opaque-actor-token');
    expect(shown).not.toContain('agent-secret');
  });

  test('says which grant AIC refused', async () => {
    const aic = fakeAic({ token: () => json(400, { error: 'unauthorized_client', error_description: 'The authenticated client is not authorized to use this authorization grant type.' }) });
    await expect(aicDemo.fetchActorToken({ session: {} }, { store: store(), fetchImpl: aic.fetchImpl }))
      .rejects.toThrow(/unauthorized_client: The authenticated client is not authorized/);
  });

  test('is not configured without the actor client secret', async () => {
    expect(aicDemo.featureStatus(store({ aic_actor_client_secret: '' }))).toEqual({ login: true, actor: false });
    await expect(aicDemo.fetchActorToken({ session: {} }, { store: store({ aic_actor_client_secret: '' }), fetchImpl: fakeAic().fetchImpl }))
      .rejects.toMatchObject({ code: 'AIC_NOT_CONFIGURED' });
  });
});

describe('AIC demo: delegation exchange (RFC 8693)', () => {
  const session = () => ({
    aicDemo: {
      userTokens: { accessToken: 'opaque-user-token', subject: 'alice' },
      actorTokens: { accessToken: 'opaque-actor-token' },
    },
  });

  test('sends both tokens as the actor client and shows the act claim from introspection', async () => {
    const req = { session: session() };
    const aic = fakeAic({
      token: () => json(200, {
        access_token: 'opaque-delegated-token', scope: 'repair', expires_in: 3600,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      }),
      introspect: () => json(200, { active: true, sub: 'alice', scope: 'repair', act: { sub: 'agent' } }),
    });
    const result = await aicDemo.exchangeTokens(req, { store: store(), fetchImpl: aic.fetchImpl });

    const call = aic.calls.find((c) => c.url.endsWith('/access_token'));
    expect(call.init.headers.Authorization).toBe(`Basic ${Buffer.from('agent:agent-secret').toString('base64')}`);
    expect(Object.fromEntries(call.init.body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'opaque-user-token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: 'opaque-actor-token',
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'repair',
    });
    expect(req.session.aicDemo.exchangedTokens.accessToken).toBe('opaque-delegated-token');
    expect(result.act).toEqual({ sub: 'agent' });
    expect(result.subject).toBe('alice');
    expect(result.trace.map((s) => s.id)).toEqual(['exchange', 'introspect-exchanged']);
    const shown = JSON.stringify(result);
    for (const secret of ['opaque-user-token', 'opaque-actor-token', 'opaque-delegated-token', 'agent-secret']) {
      expect(shown).not.toContain(secret);
    }
  });

  test('refuses to run until both input tokens are held', async () => {
    const req = { session: { aicDemo: { userTokens: { accessToken: 'u' } } } };
    const aic = fakeAic();
    await expect(aicDemo.exchangeTokens(req, { store: store(), fetchImpl: aic.fetchImpl }))
      .rejects.toMatchObject({ code: 'AIC_TOKENS_REQUIRED', httpStatus: 409 });
    expect(aic.calls).toHaveLength(0);
  });

  test("surfaces AIC's reason when the May Act script does not authorize the actor", async () => {
    const aic = fakeAic({ token: () => json(400, { error: 'invalid_grant', error_description: 'The actor is not authorized to act on behalf of the subject.' }) });
    await expect(aicDemo.exchangeTokens({ session: session() }, { store: store(), fetchImpl: aic.fetchImpl }))
      .rejects.toThrow(/invalid_grant: The actor is not authorized/);
  });

  test('a new actor token discards the previous delegated token', async () => {
    const req = { session: session() };
    req.session.aicDemo.exchangedTokens = { accessToken: 'old' };
    req.session.aicDemo.exchangeResult = { trace: [] };
    const aic = fakeAic({ token: () => json(200, { access_token: 'new-actor', expires_in: 3600 }) });
    await aicDemo.fetchActorToken(req, { store: store(), fetchImpl: aic.fetchImpl });
    expect(req.session.aicDemo.exchangedTokens).toBeUndefined();
    expect(req.session.aicDemo.exchangeResult).toBeUndefined();
  });
});
