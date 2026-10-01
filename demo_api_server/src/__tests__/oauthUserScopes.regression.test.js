jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    ff_oidc_only_authorize: false,
    user_role: 'customer',
  }[key] ?? '')),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));

jest.mock('../../services/oauthEndpointResolver', () => ({}));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: {
      activeId: () => 'banking',
      resolve: (id) => id === 'airlines' ? { scopes: { featureScope: 'airlines:read' } } : null,
    },
  },
}));

describe('user OAuth scope request', () => {
  test('requests the registered account-read scope for customer MCP discovery', () => {
    const oauthUser = require('../../config/oauthUser');

    expect(oauthUser.scopes).toContain('accounts:read');
  });

  test('requests the active airlines read scope with PingFederate user login', () => {
    const configStore = require('../../services/configStore');
    const manifest = require('../../services/verticalManifest');
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    manifest.verticalManifest.resolver.activeId = () => 'airlines';

    const oauthUser = require('../../config/oauthUser');

    expect(oauthUser.scopes).toContain('airlines:read');
    expect(oauthUser.scopes).not.toContain('accounts:read');
  });
});
