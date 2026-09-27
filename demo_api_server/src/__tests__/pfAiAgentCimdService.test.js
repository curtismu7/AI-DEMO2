'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { metadataDocument } = require('../../services/pfAiAgentCimdService');
const { completeCimd } = require('../../services/pfAiAgentCimdService');

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const { resolveCimdConfig } = require('../../services/pfAiAgentFeatureConfig');

function makeStore(overrides = {}) {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_par_endpoint: 'https://pf.example.test/as/par.oauth2',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

describe('PF AI Agent CIMD service', () => {
  test('publishes a public PKCE CIMD document whose client id is its own URL', () => {
    const config = resolveCimdConfig(makeStore());

    expect(metadataDocument(config)).toEqual({
      client_id: 'https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/client-metadata.json',
      client_name: 'AI Demo PingFederate Agent',
      redirect_uris: ['https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'openid profile email agent:invoke transactions:write',
      token_endpoint_auth_method: 'none',
    });
  });

  test('consumes a state-bound CIMD callback and stores PF tokens separately from the active session', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    jwk.kid = 'pf-signing-key';
    jwk.use = 'sig';
    jwk.alg = 'RS256';
    const session = {
      oauthProvider: 'pingone',
      oauthTokens: { accessToken: 'p1-session-token' },
      pfAiAgent: {
        cimdPending: {
          state: 'state-from-pf-start',
          nonce: 'nonce-from-pf-start',
          verifier: 'S256-verifier-held-in-session',
          createdAt: Date.now(),
          expiresAt: Date.now() + 300_000,
        },
      },
    };
    const idToken = jwt.sign({
      sub: 'demo-user',
      nonce: 'nonce-from-pf-start',
      iss: 'https://pf.example.test',
      aud: 'https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/client-metadata.json',
    }, privateKey, { algorithm: 'RS256', keyid: 'pf-signing-key', expiresIn: 300 });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        issuer: 'https://pf.example.test',
        authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
        token_endpoint: 'https://pf.example.test/as/token.oauth2',
        jwks_uri: 'https://pf.example.test/pf/JWKS',
        pushed_authorization_request_endpoint: 'https://pf.example.test/as/par.oauth2',
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'pf-feature-access-token',
        id_token: idToken,
        refresh_token: 'pf-feature-refresh-token',
        token_type: 'Bearer',
        expires_in: 300,
        scope: 'openid profile email agent:invoke transactions:write',
      }))
      .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));

    const result = await completeCimd({
      session,
      query: { state: 'state-from-pf-start', code: 'single-use-code' },
    }, { store: makeStore(), fetchImpl });

    expect(session.oauthTokens.accessToken).toBe('p1-session-token');
    expect(session.pfAiAgent.cimdPending).toBeUndefined();
    expect(session.pfAiAgent.cimdTokens.accessToken).toBe('pf-feature-access-token');
    expect(session.pfAiAgent.cimdTokens.refreshToken).toBe('pf-feature-refresh-token');
    expect(result).toEqual(expect.objectContaining({ subject: 'demo-user', issuer: 'https://pf.example.test' }));
    expect(fetchImpl.mock.calls[1][1].redirect).toBe('error');
    expect(JSON.stringify(result)).not.toMatch(/pf-feature-(?:access|refresh)-token|single-use-code|S256-verifier/);
  });

  test('rejects a wrong state before exchanging a code', async () => {
    const fetchImpl = jest.fn();
    const session = { pfAiAgent: { cimdPending: { state: 'expected', expiresAt: Date.now() + 300_000 } } };

    await expect(completeCimd({ session, query: { state: 'wrong', code: 'untrusted-code' } }, {
      store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_CIMD_CALLBACK_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(session.pfAiAgent.cimdPending.state).toBe('expected');
  });
});
