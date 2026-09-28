'use strict';

const { beginRar, completeRar } = require('../../services/pfAiAgentRarService');

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

function makeStore(overrides = {}) {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_ai_rar_enabled: 'true',
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

function discovery() {
  return {
    issuer: 'https://pf.example.test',
    authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    token_endpoint: 'https://pf.example.test/as/token.oauth2',
    jwks_uri: 'https://pf.example.test/pf/JWKS',
    pushed_authorization_request_endpoint: 'https://pf.example.test/as/par.oauth2',
  };
}

describe('PF AI Agent RAR service', () => {
  test('pushes policy-valid authorization details to PF PAR and returns only the PF authorization URL', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(discovery()))
      .mockResolvedValueOnce(jsonResponse({
        request_uri: 'urn:ietf:params:oauth:request_uri:opaque-value', expires_in: 90,
      }));
    const req = {
      session: {
        oauthProvider: 'pingone',
        oauthTokens: { accessToken: 'p1-session-token' },
        user: { username: 'demouser' },
      },
    };

    const result = await beginRar(req, { scenario: 'allowed', store: makeStore(), fetchImpl });

    expect(new URL(result.redirectUrl).origin).toBe('https://pf.example.test');
    expect(new URL(result.redirectUrl).searchParams.get('client_id')).toBe(
      'https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/client-metadata.json');
    expect(new URL(result.redirectUrl).searchParams.get('request_uri'))
      .toBe('urn:ietf:params:oauth:request_uri:opaque-value');
    const parBody = fetchImpl.mock.calls[1][1].body;
    const details = JSON.parse(parBody.get('authorization_details'));
    expect(details[0]).toEqual(expect.objectContaining({
      type: 'banking_transaction', user_id: 'demouser', actions: ['transfer'],
    }));
    expect(parBody.get('code_challenge_method')).toBe('S256');
    expect(parBody.get('client_id')).toBe('https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/client-metadata.json');
    expect(JSON.stringify(result)).not.toContain('p1-session-token');
  });

  test('consumes a denied PF callback as safe metadata without changing the active session', async () => {
    const session = {
      oauthProvider: 'pingone',
      oauthTokens: { accessToken: 'p1-session-token' },
      pfAiAgent: {
        rarPending: {
          state: 'rar-state', nonce: 'rar-nonce', verifier: 'secret-verifier',
          createdAt: Date.now(), expiresAt: Date.now() + 300_000, scenario: 'denied', userKey: 'demouser',
        },
      },
    };
    const result = await completeRar({ session, query: { state: 'rar-state', error: 'access_denied' } }, {
      store: makeStore(), fetchImpl: jest.fn(),
    });

    expect(result).toEqual(expect.objectContaining({ outcome: 'denied', reason: 'authorization_rejected' }));
    expect(session.oauthTokens.accessToken).toBe('p1-session-token');
    expect(session.pfAiAgent.rarPending).toBeUndefined();
    expect(session.pfAiAgent.rarResult).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/p1-session-token|secret-verifier|access_denied/);
  });

  test('does not classify a PF service error as a policy denial', async () => {
    const session = {
      pfAiAgent: {
        rarPending: {
          state: 'rar-state', nonce: 'rar-nonce', verifier: 'secret-verifier',
          createdAt: Date.now(), expiresAt: Date.now() + 300_000, scenario: 'allowed', userKey: 'demouser',
        },
      },
    };

    await expect(completeRar({ session, query: { state: 'rar-state', error: 'server_error' } }, {
      store: makeStore(), fetchImpl: jest.fn(),
    })).rejects.toMatchObject({ code: 'PF_AI_RAR_AUTHORIZATION_FAILED' });
    expect(session.pfAiAgent.rarResult).toBeUndefined();
  });

  test('constructs an out-of-policy denial scenario on the PF route only', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(discovery()))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_authorization_details' }, 400));

    await expect(beginRar({ session: { user: { username: 'demouser' }, pfAiAgent: {} } }, {
      scenario: 'denied', store: makeStore(), fetchImpl,
    })).rejects.toMatchObject({ code: 'PF_AI_RAR_POLICY_REJECTED' });
    const detail = JSON.parse(fetchImpl.mock.calls[1][1].body.get('authorization_details'))[0];
    expect(detail.user_id).not.toBe('demouser');
    expect(detail.type).toBe('banking_transaction');
  });
});
