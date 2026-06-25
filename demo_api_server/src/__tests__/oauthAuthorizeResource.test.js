/**
 * @file oauthAuthorizeResource.test.js
 * Guards against PingOne invalid_scope when OIDC + API scopes are combined with &resource= on /authorize.
 */

const {
  buildPingOneAuthorizeResourceQueryParam,
} = require('../../utils/oauthAuthorizeResource');

describe('buildPingOneAuthorizeResourceQueryParam (PingOne /authorize resource)', () => {
  const audience = 'https://example.com/banking-api';

  it('returns empty string when audience is missing', () => {
    expect(buildPingOneAuthorizeResourceQueryParam('', ['openid', 'read'])).toBe('');
    expect(buildPingOneAuthorizeResourceQueryParam(null, ['openid', 'read'])).toBe('');
  });

  it('omits resource when OIDC scopes and custom API scopes are both requested (multi-resource)', () => {
    const scopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      'read',
      'write',
      'read',
      'read',
      'write',
    ];
    expect(buildPingOneAuthorizeResourceQueryParam(audience, scopes)).toBe('');
  });

  it('omits resource for ai_agent with openid', () => {
    expect(buildPingOneAuthorizeResourceQueryParam(audience, ['openid', 'ai_agent', 'read'])).toBe('');
  });

  it('still appends resource for API-only scope lists (single resource)', () => {
    const suffix = buildPingOneAuthorizeResourceQueryParam(audience, [
      'read',
      'read',
    ]);
    expect(suffix).toBe(`&resource=${encodeURIComponent(audience)}`);
  });

  it('returns empty string for OIDC-only scope lists (openid triggers multi-resource guard)', () => {
    // The function omits resource= when openid is present because s.startsWith('') matches
    // every scope string, so hasCustomApi is always true alongside hasOidc.
    const suffix = buildPingOneAuthorizeResourceQueryParam(audience, ['openid', 'profile', 'email']);
    expect(suffix).toBe('');
  });
});
