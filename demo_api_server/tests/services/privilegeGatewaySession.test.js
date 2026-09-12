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

describe('privilege gateway session — one per app, persisted', () => {
  const originalApp = process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP;
  afterEach(() => {
    if (originalApp === undefined) delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP;
    else process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = originalApp;
    jest.restoreAllMocks();
  });

  function fakeStore(initial = {}) {
    const data = { ...initial };
    return {
      data,
      loadAll: jest.fn(() => ({ ...data })),
      save: jest.fn((app, record) => { data[app] = record; }),
      remove: jest.fn((app) => { delete data[app]; }),
    };
  }

  test('keeps a separate session per app', async () => {
    const session = load();
    remembered(session, { app: 'opensearch', accessToken: 'os-token' });
    remembered(session, { app: 'opensearch22', accessToken: 'os22-token' });

    expect(await session.getAccessToken('opensearch')).toBe('os-token');
    expect(await session.getAccessToken('opensearch22')).toBe('os22-token');

    session.clear('opensearch');
    expect(await session.getAccessToken('opensearch')).toBeNull();
    expect(await session.getAccessToken('opensearch22')).toBe('os22-token');
  });

  test('a call with no app means the default door app', async () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = 'opensearch22';
    const session = load();
    remembered(session, { app: 'opensearch22', accessToken: 'default-token' });

    expect(await session.getAccessToken()).toBe('default-token');
    expect(session.status()).toEqual({ ready: true });
    expect(session.statusAll()).toEqual({ opensearch22: { ready: true } });
  });

  test('clearAll drops every app', () => {
    const session = load();
    remembered(session, { app: 'a1' });
    remembered(session, { app: 'a2' });

    session.clearAll();

    expect(session.statusAll()).toEqual({});
  });

  test('survives a process restart through the store', async () => {
    const backing = fakeStore();
    const first = load();
    first.__setStore(backing);
    remembered(first, { app: 'opensearch', accessToken: 'persisted-token' });
    expect(backing.save).toHaveBeenCalledWith('opensearch', expect.objectContaining({ accessToken: 'persisted-token' }));

    const second = load(); // a fresh module, as after a container recreate
    second.__setStore(backing);
    expect(await second.getAccessToken('opensearch')).toBe('persisted-token');
  });

  test('does not resurrect an expired session that has no refresh token', () => {
    const backing = fakeStore({
      opensearch: { accessToken: 'dead', refreshToken: null, tokenUri: TOKEN_URI, expiresAt: Date.now() - 1000 },
    });
    const session = load();
    session.__setStore(backing);

    expect(session.status('opensearch')).toEqual({ ready: false, reason: 'no_session' });
  });

  test('a failing store still leaves a working in-memory session', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = load();
    session.__setStore({
      loadAll: () => { throw new Error('MDB_MAP_FULL'); },
      save: () => { throw new Error('MDB_MAP_FULL'); },
      remove: () => { throw new Error('MDB_MAP_FULL'); },
    });

    remembered(session, { app: 'opensearch', accessToken: 'mem-token' });

    expect(await session.getAccessToken('opensearch')).toBe('mem-token');
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('privilege gateway session — parked links (browser-bound commit)', () => {
  test('a parked token is invisible to status()/getAccessToken() until committed', async () => {
    const session = load();
    session.rememberPending('rs-1', {
      app: 'opensearch', accessToken: 'parked-token', refreshToken: null, expiresIn: 3600, tokenUri: TOKEN_URI,
    });

    expect(session.status('opensearch')).toEqual({ ready: false, reason: 'no_session' });
    expect(await session.getAccessToken('opensearch')).toBeNull();

    const committed = session.commitPending('rs-1');
    expect(committed).toEqual({ app: 'opensearch' });
    expect(await session.getAccessToken('opensearch')).toBe('parked-token');
  });

  test('commitPending is single-use', async () => {
    const session = load();
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'parked-token', tokenUri: TOKEN_URI });

    expect(session.commitPending('rs-1')).toEqual({ app: 'opensearch' });
    expect(session.commitPending('rs-1')).toBeNull();
  });

  test('an unknown rs commits nothing', () => {
    const session = load();
    expect(session.commitPending('never-parked')).toBeNull();
  });

  test('an expired parked record returns null and commits nothing', async () => {
    jest.useFakeTimers();
    const session = load();
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'parked-token', tokenUri: TOKEN_URI });

    jest.advanceTimersByTime(600_001); // PENDING_TTL_MS + 1

    expect(session.commitPending('rs-1')).toBeNull();
    expect(session.status('opensearch')).toEqual({ ready: false, reason: 'no_session' });
    jest.useRealTimers();
  });

  test('rememberPending refuses to overwrite an existing park — the first token is what commitPending returns', async () => {
    const session = load();
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'first-token', tokenUri: TOKEN_URI });
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'second-token', tokenUri: TOKEN_URI });

    expect(session.commitPending('rs-1')).toEqual({ app: 'opensearch' });
    expect(await session.getAccessToken('opensearch')).toBe('first-token');
  });

  test('discardPending makes a later commitPending return null', () => {
    const session = load();
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'parked-token', tokenUri: TOKEN_URI });

    session.discardPending('rs-1');

    expect(session.commitPending('rs-1')).toBeNull();
  });

  test('a discard before any park makes a later rememberPending a no-op, and the tombstone is swept once expired', () => {
    jest.useFakeTimers();
    const session = load();
    // /oauth/resume consumes the resume record first, so a deny can land while
    // the BFF's own sign-in is still in flight — the discard must still be
    // honoured once that park finally arrives.
    session.discardPending('rs-1');
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'late-token', tokenUri: TOKEN_URI });
    expect(session.commitPending('rs-1')).toBeNull();

    jest.advanceTimersByTime(600_001); // PENDING_TTL_MS + 1
    // The tombstone itself expires, so a later, unrelated reuse of the same id
    // is not blocked forever.
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'fresh-token', tokenUri: TOKEN_URI });
    expect(session.commitPending('rs-1')).toEqual({ app: 'opensearch' });
    jest.useRealTimers();
  });

  test('an expired park is swept on the next rememberPending, so first-park-wins does not block a fresh one', () => {
    jest.useFakeTimers();
    const session = load();
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'stale-token', tokenUri: TOKEN_URI });

    jest.advanceTimersByTime(600_001); // PENDING_TTL_MS + 1
    // Without the sweep, first-park-wins would refuse this second park under
    // the same id even though the first one is long dead.
    session.rememberPending('rs-1', { app: 'opensearch', accessToken: 'fresh-token', tokenUri: TOKEN_URI });

    expect(session.commitPending('rs-1')).toEqual({ app: 'opensearch' });
    jest.useRealTimers();
  });
});
