/**
 * introspectAtLogin — the login-time introspection that feeds the session's
 * token-chain card. It must be safe to AWAIT before the session is saved and the
 * browser redirected: bounded, and it never throws.
 */

'use strict';

const axios = require('axios');

jest.mock('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/oauthEndpointResolver', () => ({
  getTokenEndpoint: () => 'https://auth.pingone.com/v1/environments/test-env/oauth2/token',
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  LOG_LEVELS: {},
  LOG_CATEGORIES: { AUTH: 'AUTH', ERROR: 'ERROR' },
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { INTROSPECTION: 'INTROSPECTION' },
}));

const introspectionService = require('../../services/tokenIntrospectionService');

const buildJwt = (claims) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${header}.${payload}.signature`;
};

const token = buildJwt({ iss: 'https://auth.pingone.com/env-x/as', client_id: 'user-cid', sub: 'u1' });
const SAVED_ENV = { ...process.env };

describe('introspectAtLogin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    introspectionService.clearCache();
    process.env = { ...SAVED_ENV };
    process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    process.env.PINGONE_USER_CLIENT_ID = 'user-cid';
    process.env.PINGONE_USER_CLIENT_SECRET = 'user-secret';
  });

  afterAll(() => {
    process.env = SAVED_ENV;
  });

  it('returns the session-shaped result for an active token', async () => {
    axios.post.mockResolvedValue({
      data: { active: true, sub: 'u1', client_id: 'user-cid', scope: 'openid profile', exp: 4102444800, aud: 'a' },
    });

    await expect(introspectionService.introspectAtLogin(token)).resolves.toEqual({
      active: true, sub: 'u1', exp: 4102444800, aud: 'a', scopes: ['openid', 'profile'], client_id: 'user-cid',
    });
  });

  it('reports an inactive token as active:false, not as a skip', async () => {
    axios.post.mockResolvedValue({ data: { active: false } });

    await expect(introspectionService.introspectAtLogin(token)).resolves.toMatchObject({ active: false });
  });

  it('returns null, without throwing, when introspection is not configured', async () => {
    delete process.env.PINGONE_USER_CLIENT_SECRET;

    await expect(introspectionService.introspectAtLogin(token)).resolves.toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('gives up after the timeout instead of holding the login, and returns null', async () => {
    axios.post.mockReturnValue(new Promise(() => {}));
    const started = Date.now();

    await expect(introspectionService.introspectAtLogin(token, 30)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
