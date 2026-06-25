/**
 * Tests for tokenIntrospectionService.
 *
 * PingOne binds RFC 7662 introspection to the token's REQUESTING client: a client
 * may only introspect tokens it (or its resource) was issued. The generic Worker
 * is therefore the WRONG introspector for USER access tokens minted for a custom
 * resource (e.g. enduser.ping.demo) — PingOne returns active:false → 401, which
 * the caller mis-reads as "token inactive" → "Session expired" → reauth loop.
 *
 * So the service introspects AS the token's issuing client. Resolution:
 *   1. opts.clientId/clientSecret/authMethod — caller-supplied issuing client
 *   2. PINGONE_INTROSPECTION_CLIENT_* — a dedicated introspection client (ops)
 *   3. Demo User App (PINGONE_USER_CLIENT_*) — default issuer of the user tokens
 *      this service pre-flights; uses CLIENT_SECRET_POST.
 * The Worker is deliberately NOT in this chain.
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

const configStore = require('../../services/configStore');
const introspectionService = require('../../services/tokenIntrospectionService');

const buildJwt = (claims) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${header}.${payload}.signature`;
};

const basicHeader = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

const SAVED_ENV = { ...process.env };

describe('tokenIntrospectionService — introspect as the token issuer (never the Worker)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockReset();
    configStore.getEffective.mockReturnValue(null);
    introspectionService.clearCache();

    process.env = { ...SAVED_ENV };
    delete process.env.PINGONE_INTROSPECTION_CLIENT_ID;
    delete process.env.PINGONE_INTROSPECTION_CLIENT_SECRET;
    delete process.env.PINGONE_INTROSPECTION_AUTH_METHOD;
    process.env.PINGONE_INTROSPECTION_ENDPOINT =
      'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    // The Worker is configured but MUST be ignored for introspection.
    process.env.PINGONE_WORKER_CLIENT_ID = 'worker-cid';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';
    // The Demo User App is the default introspection identity.
    process.env.PINGONE_USER_CLIENT_ID = 'user-cid';
    process.env.PINGONE_USER_CLIENT_SECRET = 'user-secret';
  });

  afterAll(() => {
    process.env = SAVED_ENV;
  });

  test('defaults to the Demo User App with POST auth (creds in body, no Authorization header)', async () => {
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read', client_id: 'user-cid' } });

    const result = await introspectionService.validateToken(buildJwt({ client_id: 'user-cid', sub: 'subject-1' }));

    expect(result.valid).toBe(true);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe(process.env.PINGONE_INTROSPECTION_ENDPOINT);
    expect(body.get('client_id')).toBe('user-cid');
    expect(body.get('client_secret')).toBe('user-secret');
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('NEVER authenticates with the Worker client, even when it is configured', async () => {
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read' } });

    await introspectionService.validateToken(buildJwt({ client_id: 'user-cid' }));

    const [, body, opts] = axios.post.mock.calls[0];
    expect(opts.headers.Authorization).not.toBe(basicHeader('worker-cid', 'worker-secret'));
    expect(body.get('client_id')).not.toBe('worker-cid');
    expect(body.get('client_secret')).not.toBe('worker-secret');
  });

  test('opts let a caller introspect AS the token\'s issuing client (basic auth)', async () => {
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read' } });

    await introspectionService.validateToken('opaque-bearer-token', {
      clientId: 'agent-cid', clientSecret: 'agent-secret', authMethod: 'basic',
    });

    const [, body, opts] = axios.post.mock.calls[0];
    expect(opts.headers.Authorization).toBe(basicHeader('agent-cid', 'agent-secret'));
    expect(body.get('client_id')).toBeNull();
  });

  test('PINGONE_INTROSPECTION_CLIENT_ID (dedicated introspection client) takes precedence over the user-app default', async () => {
    process.env.PINGONE_INTROSPECTION_CLIENT_ID = 'introspect-cid';
    process.env.PINGONE_INTROSPECTION_CLIENT_SECRET = 'introspect-secret';
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read' } });

    await introspectionService.validateToken(buildJwt({ client_id: 'x' }));

    const [, , opts] = axios.post.mock.calls[0];
    // dedicated introspection client defaults to CLIENT_SECRET_BASIC
    expect(opts.headers.Authorization).toBe(basicHeader('introspect-cid', 'introspect-secret'));
  });

  test('returns valid:false when PingOne reports the token inactive', async () => {
    axios.post.mockResolvedValue({ data: { active: false } });

    const result = await introspectionService.validateToken(buildJwt({ client_id: 'user-cid' }));

    expect(result.valid).toBe(false);
  });

  test('returns valid:false (does not throw) and skips the HTTP call when no issuing client is configured', async () => {
    // No opts, no dedicated introspection client, no user app → not configured.
    // The Worker remaining set must NOT be used as a fallback.
    delete process.env.PINGONE_USER_CLIENT_ID;
    delete process.env.PINGONE_USER_CLIENT_SECRET;

    const result = await introspectionService.validateToken(buildJwt({ client_id: 'x' }));

    expect(result.valid).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
