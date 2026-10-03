/**
 * PingFederate introspection in tokenIntrospectionService.
 *
 * The path is chosen by the TOKEN'S ISSUER, not the active provider: admin sign-ins
 * under a PingFederate provider still carry PingOne tokens, and PingFederate would
 * report those inactive. Missing PF credentials stay "not configured" (a skip); a PF
 * HTTP failure is reported as an inactive token (the PingOne path's behaviour too).
 */

'use strict';

const axios = require('axios');

jest.mock('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/oauthEndpointResolver', () => ({
  getTokenEndpoint: () => 'https://auth.pingone.com/v1/environments/test-env/oauth2/token',
  getIssuer: jest.fn(),
  getIntrospectionEndpoint: jest.fn(),
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

const configStore = require('../../services/configStore');
const resolver = require('../../services/oauthEndpointResolver');
const introspectionService = require('../../services/tokenIntrospectionService');

const PF_ISSUER = 'https://local.ping-devops.com:9031';
const PF_INTROSPECT = 'https://local.ping-devops.com:9031/as/introspect.oauth2';

const buildJwt = (claims) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${header}.${payload}.signature`;
};

const pfToken = buildJwt({ iss: PF_ISSUER, client_id: 'ai-demo-pf-user', sub: 'demouser' });
const pingOneToken = buildJwt({ iss: 'https://auth.pingone.com/env-x/as', client_id: 'p1-user-cid', sub: 'p1-sub' });

const SAVED_ENV = { ...process.env };

function pfConfig(values) {
  configStore.getEffective.mockImplementation((key) => values[key] ?? null);
}

describe('tokenIntrospectionService — PingFederate-issued tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    introspectionService.clearCache();
    process.env = { ...SAVED_ENV };
    process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    process.env.PINGONE_USER_CLIENT_ID = 'p1-user-cid';
    process.env.PINGONE_USER_CLIENT_SECRET = 'p1-user-secret';
    resolver.getIssuer.mockReturnValue(PF_ISSUER);
    resolver.getIntrospectionEndpoint.mockReturnValue(PF_INTROSPECT);
    pfConfig({ pf_introspection_client_id: 'ai-demo-pf-introspection', pf_introspection_client_secret: 'pf-secret' });
  });

  afterAll(() => {
    process.env = SAVED_ENV;
  });

  it('introspects a PF-issued token at the PF endpoint as the PF introspection client (Basic)', async () => {
    axios.post.mockResolvedValue({
      data: { active: true, sub: 'demouser', client_id: 'ai-demo-pf-user', scope: 'openid profile', exp: 4102444800 },
    });

    const result = await introspectionService.validateToken(pfToken);

    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe(PF_INTROSPECT);
    expect(config.headers.Authorization).toBe('Basic ' + Buffer.from('ai-demo-pf-introspection:pf-secret').toString('base64'));
    expect(new URLSearchParams(body).get('token')).toBe(pfToken);
    expect(result).toMatchObject({ valid: true, sub: 'demouser', client_id: 'ai-demo-pf-user', scopes: ['openid', 'profile'] });
  });

  it('never sends a PingOne-issued token to PingFederate, even when PF is configured', async () => {
    axios.post.mockResolvedValue({ data: { active: true, sub: 'p1-sub', client_id: 'p1-user-cid' } });

    await introspectionService.validateToken(pingOneToken);

    expect(axios.post.mock.calls[0][0]).toBe('https://auth.pingone.com/v1/environments/test-env/oauth2/introspect');
    expect(axios.post.mock.calls[0][0]).not.toBe(PF_INTROSPECT);
  });

  it('skips as "not configured" when the PF introspection client or secret is missing', async () => {
    pfConfig({ pf_introspection_client_id: 'ai-demo-pf-introspection' });

    await expect(introspectionService.validateToken(pfToken)).rejects.toMatchObject({ code: 'INTROSPECTION_NOT_CONFIGURED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('reports a PF HTTP failure as an inactive token, like the PingOne path', async () => {
    axios.post.mockRejectedValue(new Error('Request failed with status code 401'));

    await expect(introspectionService.validateToken(pfToken)).resolves.toEqual({ valid: false, error: 'token_introspection_failed' });
  });

  it('treats a PF "active:false" answer as invalid', async () => {
    axios.post.mockResolvedValue({ data: { active: false } });

    await expect(introspectionService.validateToken(pfToken)).resolves.toMatchObject({ valid: false });
  });
});
