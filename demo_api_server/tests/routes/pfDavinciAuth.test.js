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
    pfDavinciAuth.status(req, res);
    expect(res.json).toHaveBeenLastCalledWith({ configured: true, authenticated: true });
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
