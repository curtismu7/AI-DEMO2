'use strict';

const configStore = require('../services/configStore');
const { getUserRedirectUri } = require('../services/oauthRedirectUris');

describe('provider-specific user redirect URI', () => {
  const req = { headers: { host: 'local.ping-devops.com:4000' } };

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PUBLIC_APP_URL;
    delete process.env.REACT_APP_CLIENT_URL;
  });

  test.each([
    ['pingone', 'user_redirect_uri', 'pf_user_redirect_uri'],
    ['pingfederate', 'pf_user_redirect_uri', 'user_redirect_uri'],
  ])('%s reads only its own redirect override', (provider, selectedKey, otherKey) => {
    const selectedUri = `https://selected.example.test/${provider}`;
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue(provider);
    const effective = jest.spyOn(configStore, 'getEffective').mockImplementation((key) => ({
      [selectedKey]: selectedUri,
      [otherKey]: 'https://other.example.test/callback',
    })[key] || '');

    expect(getUserRedirectUri(req)).toBe(selectedUri);
    expect(effective).toHaveBeenCalledWith(selectedKey);
    expect(effective).not.toHaveBeenCalledWith(otherKey);
  });

  test.each(['pingone', 'pingfederate'])('%s uses the canonical origin when its override is absent', (provider) => {
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue(provider);
    jest.spyOn(configStore, 'getEffective').mockReturnValue('');
    process.env.PUBLIC_APP_URL = 'https://local.ping-devops.com:4000/';

    expect(getUserRedirectUri(req)).toBe('https://local.ping-devops.com:4000/api/auth/oauth/user/callback');
  });

  test.each([
    ['pingone', 'user_redirect_uri', 'pf_user_redirect_uri'],
    ['pingfederate', 'pf_user_redirect_uri', 'user_redirect_uri'],
  ])('%s does not fall back to the other provider override', (provider, selectedKey, otherKey) => {
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue(provider);
    const effective = jest.spyOn(configStore, 'getEffective').mockImplementation((key) =>
      key === otherKey ? 'https://other.example.test/callback' : '',
    );
    process.env.PUBLIC_APP_URL = 'https://local.ping-devops.com:4000/';

    expect(getUserRedirectUri(req)).toBe('https://local.ping-devops.com:4000/api/auth/oauth/user/callback');
    expect(effective).toHaveBeenCalledWith(selectedKey);
    expect(effective).not.toHaveBeenCalledWith(otherKey);
  });
});
