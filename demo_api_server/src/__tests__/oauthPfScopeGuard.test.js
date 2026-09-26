'use strict';

// Guard for the 2026-09-26 invalid_scope incidents (REGRESSION_PLAN §4):
// PingFederate's ai-demo-pf-user / ai-demo-pf-admin clients are OIDC-only.
// Any banking/agent scope in the PF-mode authorize request makes PF reject it
// with invalid_scope before the sign-on page renders. These tests pin the
// provider-aware branches in config/oauthUser.js and config/oauth.js so a
// refactor cannot silently re-merge the PingOne scope lists into PF mode.

const PF_OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const FORBIDDEN_PF_SCOPES = [
  'read', 'write', 'transfer', 'accounts:read', 'transactions:read',
  'ai:agent:read', 'admin:read', 'sensitive:read', 'airlines:read', 'ai_agent',
];

// Provider is env-driven (getOAuthProvider reads OAUTH_PROVIDER via
// getEffective) — one env knob, no mock-internal state to leak across
// resetModules, which would otherwise re-run the factory and reset it.
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'oauth_provider') return process.env.TEST_OAUTH_PROVIDER || 'pingfederate';
    if (key === 'ff_oidc_only_authorize') return false;
    if (key === 'user_role') return 'customer';
    return '';
  }),
  getOAuthProvider: jest.fn(() => process.env.TEST_OAUTH_PROVIDER || 'pingfederate'),
}));

jest.mock('../../services/oauthEndpointResolver', () => ({
  getAuthorizationEndpoint: () => 'https://pf.example.test/as/authorization.oauth2',
  getTokenEndpoint: () => 'https://pf.example.test/as/token.oauth2',
  getUserInfoEndpoint: () => 'https://pf.example.test/idp/userinfo.openid',
  getJwksUri: () => 'https://pf.example.test/pf/JWKS',
  getIntrospectionEndpoint: () => '',
  getRevocationEndpoint: () => '',
  getIssuer: () => 'https://pf.example.test',
  getDiscoveryEndpoint: () => 'https://pf.example.test/.well-known/openid-configuration',
}));

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: { activeId: () => 'banking', resolve: () => null },
  },
}));

const setProvider = (p) => { process.env.TEST_OAUTH_PROVIDER = p; };
const origProvider = process.env.TEST_OAUTH_PROVIDER;
const origEnduserAudience = process.env.ENDUSER_AUDIENCE;

afterAll(() => {
  if (origProvider === undefined) delete process.env.TEST_OAUTH_PROVIDER;
  else process.env.TEST_OAUTH_PROVIDER = origProvider;
  if (origEnduserAudience === undefined) delete process.env.ENDUSER_AUDIENCE;
  else process.env.ENDUSER_AUDIENCE = origEnduserAudience;
});

describe('PF-mode authorize scopes guard (invalid_scope regression)', () => {
  beforeEach(() => setProvider('pingfederate'));

  test('user client: PF mode requests ONLY OIDC scopes', () => {
    expect(require('../../config/oauthUser').scopes.sort())
      .toEqual([...PF_OIDC_SCOPES].sort());
  });

  test('admin client: PF mode requests ONLY OIDC scopes', () => {
    expect(require('../../config/oauth').scopes.sort())
      .toEqual([...PF_OIDC_SCOPES].sort());
  });

  test.each([
    ['user', () => require('../../config/oauthUser').scopes],
    ['admin', () => require('../../config/oauth').scopes],
  ])('%s client: PF mode never carries a banking/agent scope', (_label, getScopes) => {
    const offenders = getScopes().filter((s) => FORBIDDEN_PF_SCOPES.includes(s));
    expect(offenders).toEqual([]);
  });

  test('user client: PingOne mode keeps transfer for create_transfer', () => {
    setProvider('pingone');
    process.env.ENDUSER_AUDIENCE = 'https://banking.example.test';
    jest.resetModules();
    try {
      expect(require('../../config/oauthUser').scopes).toContain('transfer');
    } finally {
      jest.resetModules();
    }
  });

  test('admin client: PingOne mode keeps its admin scopes (behavior unchanged)', () => {
    setProvider('pingone');
    expect(require('../../config/oauth').scopes).toContain('admin:read');
  });
});
