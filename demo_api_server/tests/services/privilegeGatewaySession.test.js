'use strict';

// The façade's server-side gateway leg. See the module header for why it
// exists: the AI Gateway keeps its DCR client registry in memory, so pointing
// standalone MCP clients at it means a restart breaks their stored
// registration. This holds the gateway hop instead.

const SESSION_PATH = '../../services/privilegeGatewaySession';
const TOKEN_URI = 'https://mcpgw.example.com/opensearch22/token';

function load() {
  jest.resetModules();
  return require(SESSION_PATH);
}

function remembered(session, overrides = {}) {
  session.remember({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 3600,
    tokenUri: TOKEN_URI,
    clientId: 'dcr-client-1',
    ...overrides,
  });
}

describe('privilege gateway session', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  test('has no token until a sign-in hands one over', async () => {
    const session = load();
    expect(await session.getAccessToken()).toBeNull();
    expect(session.status()).toEqual({ ready: false, reason: 'no_session' });
  });

  test('serves a live token without touching the network', async () => {
    const session = load();
    global.fetch = jest.fn();
    remembered(session);

    expect(await session.getAccessToken()).toBe('access-1');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(session.status()).toEqual({ ready: true });
  });

  test('refreshes a token that is inside the expiry skew', async () => {
    const session = load();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'access-2', expires_in: 3600 }),
    }));
    remembered(session, { expiresIn: 5 }); // inside REFRESH_SKEW_MS

    expect(await session.getAccessToken()).toBe('access-2');
    const body = String(global.fetch.mock.calls[0][1].body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=dcr-client-1');
  });

  test('drops the session when refresh is rejected, so the operator is told to sign in', async () => {
    const session = load();
    // What a gateway restart looks like: the client the token belongs to is gone.
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, text: async () => 'Invalid client credentials' }));
    remembered(session, { expiresIn: 5 });

    expect(await session.getAccessToken()).toBeNull();
    expect(session.status()).toEqual({ ready: false, reason: 'no_session' });
  });

  test('keeps the session when refresh fails at the network level', async () => {
    const session = load();
    // A blip is not proof the session is dead — discarding it would force an
    // unnecessary human sign-in.
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); });
    remembered(session, { expiresIn: 5 });

    expect(await session.getAccessToken()).toBeNull();
    expect(session.status().reason).toBe('refreshable');
  });

  test('treats a token with no expires_in as short-lived rather than eternal', async () => {
    const session = load();
    remembered(session, { expiresIn: undefined });
    expect(session.status()).toEqual({ ready: true });
  });
});
