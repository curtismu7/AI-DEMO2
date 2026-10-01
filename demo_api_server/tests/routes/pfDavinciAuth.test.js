'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pfDavinciAuth = require('../../routes/pfDavinciAuth');

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const issuer = 'https://local.ping-devops.com:9031';
const redirectUri = 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback';
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/as/authorization.oauth2`,
  token_endpoint: `${issuer}/as/token.oauth2`,
  jwks_uri: `${issuer}/pf/JWKS`,
};

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function exchange() {
  const session = {
    oauthTokens: { accessToken: 'existing-pingone-token' },
    user: { oauthProvider: 'pingone_sso' },
    save: (callback) => callback(null),
  };
  const req = { session, query: {} };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('dedicated PF DaVinci sign-in', () => {
  const original = {};

  beforeEach(() => {
    for (const name of ['PF_ISSUER', 'PF_USER_CLIENT_ID', 'PF_USER_CLIENT_SECRET', 'PF_USER_REDIRECT_URI']) {
      original[name] = process.env[name];
    }
    process.env.PF_ISSUER = issuer;
    process.env.PF_USER_CLIENT_ID = 'pf-lesson-client';
    process.env.PF_USER_CLIENT_SECRET = 'local-test-secret';
    process.env.PF_USER_REDIRECT_URI = redirectUri;
    global.fetch = jest.fn().mockResolvedValue(response(metadata));
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete global.fetch;
    jest.restoreAllMocks();
  });

  it.each(['RS256', 'ES256'])('keeps PingOne tokens while proving PF login with %s', async (algorithm) => {
    const { req, res } = exchange();
    await pfDavinciAuth.login(req, res);
    const authorize = new URL(res.redirect.mock.calls[0][0]);
    expect(authorize.origin).toBe(issuer);
    expect(authorize.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(req.session.oauthTokens.accessToken).toBe('existing-pingone-token');

    const { publicKey, privateKey } = algorithm === 'RS256'
      ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
      : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const idToken = jwt.sign({ nonce: req.session.pfDavinciPending.nonce }, privateKey, {
      algorithm, keyid: 'pf-signing-key', issuer,
      audience: process.env.PF_USER_CLIENT_ID, subject: 'pf-user', expiresIn: 300,
    });
    global.fetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({ id_token: idToken }))
      .mockResolvedValueOnce(response({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'pf-signing-key' }] }));
    req.query = { code: 'one-time-code', state: req.session.pfDavinciPending.state };
    await pfDavinciAuth.callback(req, res);

    expect(res.redirect).toHaveBeenLastCalledWith(
      'https://local.ping-devops.com:4000/pingfederate-davinci-kit?pf_davinci=success'
    );
    expect(req.session.oauthTokens.accessToken).toBe('existing-pingone-token');
    expect(req.session.user.oauthProvider).toBe('pingone_sso');
    expect(req.session.pfDavinciProof.idToken).toBe(idToken);
    expect(req.session.oauthTokens.idToken).toBeUndefined();
    pfDavinciAuth.status(req, res);
    expect(res.json).toHaveBeenLastCalledWith({ configured: true, authenticated: true });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(idToken);
  });

  it('keeps the PF ID token beside, not inside, the PingOne tokens and exchanges it for an ID-JAG', async () => {
    const { req, res } = exchange();
    req.session.pfDavinciProof = { issuer, expiresAt: Date.now() + 60_000, idToken: 'pf.id.token' };
    global.fetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({
        access_token: 'the.id.jag', issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
        token_type: 'N_A', expires_in: 300, refresh_token: 'must-not-leak',
      }));
    const result = await pfDavinciAuth.exchangeIdJag(req, { audience: 'https://rs.example/' });

    const [url, init] = global.fetch.mock.calls[1];
    const sent = new URLSearchParams(init.body);
    expect(url).toBe(metadata.token_endpoint);
    expect(sent.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(sent.get('requested_token_type')).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(sent.get('subject_token')).toBe('pf.id.token');
    expect(sent.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(sent.get('audience')).toBe('https://rs.example/');
    expect(result).toEqual({
      access_token: 'the.id.jag', issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
      token_type: 'N_A', expires_in: 300,
    });
    expect(req.session.oauthTokens.accessToken).toBe('existing-pingone-token');
  });

  it('returns null without a live PF sign-in and only the OAuth error code when PF refuses', async () => {
    const { req } = exchange();
    expect(await pfDavinciAuth.exchangeIdJag(req, { audience: 'a' })).toBeNull();
    req.session.pfDavinciProof = { issuer, expiresAt: Date.now() - 1, idToken: 'stale' };
    expect(await pfDavinciAuth.exchangeIdJag(req, { audience: 'a' })).toBeNull();
    req.session.pfDavinciProof = { issuer, expiresAt: Date.now() + 60_000, idToken: 'pf.id.token' };
    global.fetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({ error: 'invalid_grant', error_description: 'secret detail' }, 400));
    expect(await pfDavinciAuth.exchangeIdJag(req, { audience: 'a' })).toEqual({ error: 'invalid_grant' });
  });

  it('rejects a callback whose state does not match the PF login', async () => {
    const { req, res } = exchange();
    await pfDavinciAuth.login(req, res);
    req.query = { code: 'one-time-code', state: 'pf-wrong' };
    await pfDavinciAuth.callback(req, res);

    expect(res.redirect).toHaveBeenLastCalledWith(
      'https://local.ping-devops.com:4000/pingfederate-davinci-kit?pf_davinci=error'
    );
    pfDavinciAuth.status(req, res);
    expect(res.json).toHaveBeenLastCalledWith({ configured: true, authenticated: false });
  });
});
