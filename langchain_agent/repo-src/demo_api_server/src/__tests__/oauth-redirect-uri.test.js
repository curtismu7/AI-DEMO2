/**
 * @file oauth-redirect-uri.test.js
 * @description Redirect URIs sent to PingOne must match allowlist; PUBLIC_APP_URL must win over deployment host.
 */

const configStore = require('../../services/configStore');
const {
  getAdminRedirectUri,
  getUserRedirectUri,
  getOAuthRedirectDebugInfo,
  REFERENCE_REDIRECT_SETS,
} = require('../../services/oauthRedirectUris');

function mockReq(host, forwardedHost) {
  return {
    protocol: 'https',
    get(name) {
      if (name === 'host') return host;
      if (name === 'x-forwarded-host') return forwardedHost;
      return undefined;
    },
  };
}

describe('oauthRedirectUris', () => {
  let origGetEffective;

  beforeEach(() => {
    origGetEffective = configStore.getEffective.bind(configStore);
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (['admin_redirect_uri', 'user_redirect_uri', 'frontend_url'].includes(key)) return '';
      return origGetEffective(key);
    });
  });

  afterEach(() => {
    configStore.getEffective.mockRestore();
    delete process.env.PUBLIC_APP_URL;
    delete process.env.REACT_APP_CLIENT_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL;
  });

  it('uses PUBLIC_APP_URL for admin and user callbacks on Vercel (ignores deployment host)', () => {
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    const req = mockReq('banking-demo-ephemeral-hash.vercel.app');
    expect(getAdminRedirectUri(req, { silent: true })).toBe(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/callback'
    );
    expect(getUserRedirectUri(req, { silent: true })).toBe(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback'
    );
  });

  it('uses localhost:3001 paths when not on Vercel', () => {
    const req = mockReq('localhost:3001');
    expect(getAdminRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3001/api/auth/oauth/callback'
    );
    expect(getUserRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3001/api/auth/oauth/user/callback'
    );
  });

  it('getOAuthRedirectDebugInfo lists URIs to register in PingOne', () => {
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    const info = getOAuthRedirectDebugInfo(mockReq('other.vercel.app'));
    expect(info.canonicalOrigin).toBe('https://banking-demo-puce.vercel.app');
    expect(info.pingOneRegisterThese).toContain(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/callback'
    );
    expect(info.pingOneRegisterThese).toContain(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback'
    );
  });

  // -------------------------------------------------------------------------
  // Fallback ordering
  // -------------------------------------------------------------------------
  it('uses REACT_APP_CLIENT_URL origin when PUBLIC_APP_URL and VERCEL are not set', () => {
    // REACT_APP_CLIENT_URL feeds getCanonicalPublicOrigin() so its value wins
    process.env.REACT_APP_CLIENT_URL = 'http://localhost:3000';
    const req = mockReq('localhost:3001');
    expect(getAdminRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3000/api/auth/oauth/callback'
    );
    expect(getUserRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3000/api/auth/oauth/user/callback'
    );
    delete process.env.REACT_APP_CLIENT_URL;
  });

  it('configStore admin_redirect_uri override takes priority over everything', () => {
    const override = 'https://my-custom-host.example.com/api/auth/oauth/callback';
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    // Return the override only for the admin redirect key
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'admin_redirect_uri') return override;
      return '';
    });
    expect(getAdminRedirectUri(mockReq('other.vercel.app'), { silent: true })).toBe(override);
  });

  it('configStore user_redirect_uri override takes priority over everything', () => {
    const override = 'https://my-custom-host.example.com/api/auth/oauth/user/callback';
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'user_redirect_uri') return override;
      return '';
    });
    expect(getUserRedirectUri(mockReq('other.vercel.app'), { silent: true })).toBe(override);
  });

  // -------------------------------------------------------------------------
  // Forwarded host handling (load-balanced / CDN environments)
  // -------------------------------------------------------------------------
  it('prefers x-forwarded-host over raw host header', () => {
    // No PUBLIC_APP_URL — falls through to request host detection.
    // mockReq protocol is 'https' but code reads req.get('x-forwarded-proto') || req.secure,
    // neither of which mockReq provides, so protocol falls back to 'http'.
    const req = mockReq('internal-lb.aws.local', 'banking-demo.example.com');
    const adminUri = getAdminRedirectUri(req, { silent: true });
    const userUri  = getUserRedirectUri(req, { silent: true });
    expect(adminUri).toContain('banking-demo.example.com');
    expect(adminUri).toContain('/api/auth/oauth/callback');
    expect(userUri).toContain('banking-demo.example.com');
    expect(userUri).toContain('/api/auth/oauth/user/callback');
    // Internal host must not appear
    expect(adminUri).not.toContain('internal-lb');
    expect(userUri).not.toContain('internal-lb');
  });

  it('uses only the first value when x-forwarded-host is a comma-separated list', () => {
    const req = {
      protocol: 'https',
      get(name) {
        if (name === 'x-forwarded-host') return 'first.example.com, second.example.com';
        if (name === 'host') return 'raw-host.internal';
        return undefined;
      },
    };
    const uri = getAdminRedirectUri(req, { silent: true });
    expect(uri).toContain('first.example.com');
    expect(uri).not.toContain('second.example.com');
    expect(uri).not.toContain('raw-host.internal');
    expect(uri).toContain('/api/auth/oauth/callback');
  });

  // -------------------------------------------------------------------------
  // Path correctness
  // -------------------------------------------------------------------------
  it('admin redirect_uri path is exactly /api/auth/oauth/callback', () => {
    process.env.PUBLIC_APP_URL = 'https://bank.example.com';
    process.env.VERCEL = '1';
    const uri = getAdminRedirectUri(mockReq('bank.example.com'), { silent: true });
    expect(new URL(uri).pathname).toBe('/api/auth/oauth/callback');
  });

  it('user redirect_uri path is exactly /api/auth/oauth/user/callback', () => {
    process.env.PUBLIC_APP_URL = 'https://bank.example.com';
    process.env.VERCEL = '1';
    const uri = getUserRedirectUri(mockReq('bank.example.com'), { silent: true });
    expect(new URL(uri).pathname).toBe('/api/auth/oauth/user/callback');
  });

  it('trailing slash in PUBLIC_APP_URL is stripped before building redirect_uri', () => {
    process.env.PUBLIC_APP_URL = 'https://bank.example.com/';  // trailing slash
    process.env.VERCEL = '1';
    const admin = getAdminRedirectUri(mockReq('bank.example.com'), { silent: true });
    const user  = getUserRedirectUri(mockReq('bank.example.com'), { silent: true });
    // Pathname must not start with double slash (i.e. origin// path)
    expect(new URL(admin).pathname).toBe('/api/auth/oauth/callback');
    expect(new URL(user).pathname).toBe('/api/auth/oauth/user/callback');
    // Origin must not end with slash (checked via the full URL structure)
    expect(admin).toBe('https://bank.example.com/api/auth/oauth/callback');
    expect(user).toBe('https://bank.example.com/api/auth/oauth/user/callback');
  });

  // -------------------------------------------------------------------------
  // debugInfo structure
  // -------------------------------------------------------------------------
  it('getOAuthRedirectDebugInfo includes both admin and user URIs in pingOneRegisterThese', () => {
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    const info = getOAuthRedirectDebugInfo(mockReq('other.vercel.app'));
    expect(Array.isArray(info.pingOneRegisterThese)).toBe(true);
    expect(info.pingOneRegisterThese.length).toBeGreaterThanOrEqual(2);
    const paths = info.pingOneRegisterThese.map((u) => new URL(u).pathname);
    expect(paths).toContain('/api/auth/oauth/callback');
    expect(paths).toContain('/api/auth/oauth/user/callback');
  });

  it('getOAuthRedirectDebugInfo includes reference sets for api.ping.demo and a custom host', () => {
    const info = getOAuthRedirectDebugInfo(mockReq('localhost:3001'));
    expect(Array.isArray(info.referenceRedirectSets)).toBe(true);
    expect(info.referenceRedirectSets.length).toBeGreaterThanOrEqual(2);
    const apiPingDemo = info.referenceRedirectSets.find((r) => r.id === 'api-ping-demo');
    const customHost = info.referenceRedirectSets.find((r) => r.id === 'custom-host');
    expect(apiPingDemo.adminRedirectUri).toBe('https://api.ping.demo:4000/api/auth/oauth/callback');
    expect(customHost.adminRedirectUri).toBe('https://api.pingdeme.org/api/auth/oauth/callback');
    expect(customHost.userRedirectUri).toBe('https://api.pingdeme.org/api/auth/oauth/user/callback');
    expect(REFERENCE_REDIRECT_SETS).toBe(info.referenceRedirectSets);
  });
});
