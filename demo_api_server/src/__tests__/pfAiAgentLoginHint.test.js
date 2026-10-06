'use strict';

const { beginCimd } = require('../../services/pfAiAgentCimdService');
const { beginRar } = require('../../services/pfAiAgentRarService');
const { loginHintFor } = require('../../services/pfAiAgentOAuthService');

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

function makeStore() {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_ai_rar_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_par_endpoint: 'https://pf.example.test/as/par.oauth2',
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const discovery = () => json({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: 'https://pf.example.test/as/token.oauth2',
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  pushed_authorization_request_endpoint: 'https://pf.example.test/as/par.oauth2',
});
const session = (username = 'demouser') => ({
  session: { oauthProvider: 'pingfederate', oauthTokens: { accessToken: 't' }, user: username ? { username } : undefined },
});

const pingOneSession = (username) => ({
  session: { oauthProvider: 'pingone', oauthTokens: { accessToken: 't' }, user: { username } },
});

describe('login_hint spelling: PingFederate users are lowercase and case-sensitive', () => {
  // Regression: the hint was the session's own name, so a PingOne "demoUser" pre-filled PingFederate's sign-in
  // with "demoUser", which PingFederate (its users are "demouser") answered with "bad password".
  test('a PingOne session named demoUser hints demouser on the CIMD URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery());
    const { redirectUrl } = await beginCimd(pingOneSession('demoUser'), { store: makeStore(), fetchImpl });
    expect(new URL(redirectUrl).searchParams.get('login_hint')).toBe('demouser');
  });

  test('a PingOne session named demoUser hints demouser on the RAR PAR request, even for a typed demoUser', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(json({ request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 90 }));
    await beginRar(pingOneSession('demoUser'), { scenario: 'allowed', userKey: 'demoUser', store: makeStore(), fetchImpl });
    expect(fetchImpl.mock.calls[1][1].body.get('login_hint')).toBe('demouser');
  });

  test('a PingFederate session keeps the spelling PingFederate gave it', () => {
    expect(loginHintFor(session('MixedCase'))).toBe('MixedCase');
    expect(loginHintFor(pingOneSession('MixedCase'))).toBe('mixedcase');
  });
});

describe('login_hint: PingFederate is told who is signing in', () => {
  test('the CIMD authorize URL carries the signed-in username', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery());
    const { redirectUrl } = await beginCimd(session(), { store: makeStore(), fetchImpl });
    expect(new URL(redirectUrl).searchParams.get('login_hint')).toBe('demouser');
  });

  test('without a username there is no login_hint at all', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery());
    const { redirectUrl } = await beginCimd(session(null), { store: makeStore(), fetchImpl });
    expect(new URL(redirectUrl).searchParams.has('login_hint')).toBe(false);
  });

  test('the RAR PAR request carries the user the request names', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(json({ request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 90 }));
    await beginRar(session(), { scenario: 'allowed', store: makeStore(), fetchImpl });
    expect(fetchImpl.mock.calls[1][1].body.get('login_hint')).toBe('demouser');
  });

  test('a username with control characters or an absurd length is not sent', () => {
    expect(loginHintFor(session('bad\nname'))).toBe('');
    expect(loginHintFor(session('x'.repeat(257)))).toBe('');
    expect(loginHintFor(session('  demouser  '))).toBe('demouser');
  });
});
