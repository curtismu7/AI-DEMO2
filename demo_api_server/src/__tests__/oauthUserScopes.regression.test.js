jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    ff_oidc_only_authorize: false,
    user_role: 'customer',
  }[key] ?? '')),
}));

jest.mock('../../services/oauthEndpointResolver', () => ({}));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: { activeId: () => 'banking', resolve: () => null },
  },
}));

describe('user OAuth scope request', () => {
  test('requests the registered account-read scope for customer MCP discovery', () => {
    const oauthUser = require('../../config/oauthUser');

    expect(oauthUser.scopes).toContain('accounts:read');
  });
});
