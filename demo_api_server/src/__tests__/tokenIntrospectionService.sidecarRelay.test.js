/**
 * Introspection for tokens issued to a client the identity sidecar manages (ff_agent_identity_sidecar).
 * PingOne only lets a client introspect tokens IT issued, so such a token is introspected through
 * the sidecar (which holds that client's secret). Other tokens, and the flag OFF, are introspected
 * with the local credentials exactly as before.
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

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({
  logger: mockLogger,
  LOG_LEVELS: {},
  LOG_CATEGORIES: { AUTH: 'AUTH', ERROR: 'ERROR' },
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { INTROSPECTION: 'INTROSPECTION' },
}));

const mockRelay = { manages: jest.fn(), post: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const introspectionService = require('../../services/tokenIntrospectionService');

const buildJwt = (claims) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${header}.${payload}.signature`;
};

const ISS = 'https://auth.pingone.com/env-x/as';
const agentToken = buildJwt({ iss: ISS, client_id: 'agent-client', sub: 'agent-sub', jti: 'a1' });
const userToken = buildJwt({ iss: ISS, client_id: 'p1-user-cid', sub: 'user-sub', jti: 'u1' });

const SAVED_ENV = { ...process.env };
const formOf = (body) => new URLSearchParams(body.toString());

describe('tokenIntrospectionService — sidecar-managed clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    introspectionService.clearCache();
    process.env = { ...SAVED_ENV };
    process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    process.env.PINGONE_USER_CLIENT_ID = 'p1-user-cid';
    process.env.PINGONE_USER_CLIENT_SECRET = 'p1-user-secret';
    mockRelay.manages.mockImplementation(async (id) => id === 'agent-client');
  });

  afterAll(() => {
    process.env = SAVED_ENV;
  });

  test('a managed client\'s token is introspected through the relay, with no secret from here', async () => {
    mockRelay.post.mockResolvedValue({ status: 200, data: { active: true, scope: 'agent:invoke', sub: 'agent-sub', client_id: 'agent-client' } });

    const result = await introspectionService.validateToken(agentToken);

    expect(result.valid).toBe(true);
    expect(result.scopes).toContain('agent:invoke');
    expect(axios.post).not.toHaveBeenCalled();
    const [kind, form] = mockRelay.post.mock.calls[0];
    expect(kind).toBe('introspect');
    const fields = formOf(form);
    expect(fields.get('client_id')).toBe('agent-client');
    expect(fields.get('token')).toBe(agentToken);
    expect(fields.has('client_secret')).toBe(false);
  });

  test('it works with no local secret for that client at all (the end state)', async () => {
    delete process.env.PINGONE_AI_AGENT_CLIENT_SECRET;
    delete process.env.PINGONE_AGENT_CLIENT_SECRET;
    mockRelay.post.mockResolvedValue({ status: 200, data: { active: true, scope: 'x' } });
    await expect(introspectionService.validateToken(agentToken)).resolves.toMatchObject({ valid: true });
  });

  test('an inactive token reported through the relay is reported as invalid', async () => {
    mockRelay.post.mockResolvedValue({ status: 200, data: { active: false } });
    await expect(introspectionService.validateToken(agentToken)).resolves.toMatchObject({ valid: false });
  });

  test('a token from a client the sidecar does not manage is introspected locally, as before', async () => {
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read' } });

    const result = await introspectionService.validateToken(userToken);

    expect(result.valid).toBe(true);
    expect(mockRelay.post).not.toHaveBeenCalled();
    expect(formOf(axios.post.mock.calls[0][1]).get('client_secret')).toBe('p1-user-secret');
  });

  test('if the sidecar cannot be asked, validation falls back to the local credentials and logs it', async () => {
    mockRelay.manages.mockRejectedValue(new Error('Identity sidecar (client list) unreachable'));
    axios.post.mockResolvedValue({ data: { active: true, scope: 'read' } });

    await expect(introspectionService.validateToken(userToken)).resolves.toMatchObject({ valid: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Identity sidecar unavailable for introspection'),
      expect.objectContaining({ message: expect.stringContaining('unreachable') }),
    );
    expect(mockRelay.post).not.toHaveBeenCalled();
  });
});
