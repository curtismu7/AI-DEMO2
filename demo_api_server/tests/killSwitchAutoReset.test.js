/**
 * The kill switch is time-boxed: 10 minutes after a kill the agent comes back
 * on its own, so a demo does not end with a permanently dead agent and nobody
 * has to remember the manual re-enable.
 *
 * Two halves, because they undo differently:
 *
 *   1. The local block (`agent:<id>:revoked`) is written with the session
 *      store's own maxAge, so it EXPIRES itself. No timer, restart-safe.
 *   2. The PingOne application disable (scope='full' only) has no TTL — it
 *      stays until something calls the Management API again. So killAgent
 *      records a due-at marker and sweepDueAppReenables() acts on it. That
 *      marker outlives the revoked flag deliberately: a setTimeout would be
 *      lost on a BFF restart and leave the agent client disabled forever.
 *
 * The PingOne USER account is deliberately NOT auto-re-enabled — an admin
 * re-enables a disabled human account on purpose.
 */
'use strict';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Session store standing in for LmdbSessionStore, honouring cookie.maxAge the
// same way it does (services/lmdb/sessionStore.js: expire = now + maxAge, and
// an entry at/after its expire reads back as absent).
let mockNowMs = 1_700_000_000_000;
const mockBacking = new Map();

jest.mock('../middleware/sessionConfig', () => ({
  store: {
    get(key, cb) {
      const entry = mockBacking.get(key);
      if (!entry || entry.expire <= mockNowMs) return cb(null, null);
      return cb(null, entry.sess);
    },
    set(key, value, cb) {
      const maxAge = value?.cookie?.maxAge || ONE_DAY_MS;
      mockBacking.set(key, { sess: value, expire: mockNowMs + maxAge });
      cb(null);
    },
    destroy(key, cb) { mockBacking.delete(key); cb(null); },
    all(cb) {
      const out = {};
      for (const [key, entry] of mockBacking.entries()) {
        if (entry.expire > mockNowMs) out[key] = entry.sess;
      }
      cb(null, out);
    },
  },
}));

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200 }),
  isAxiosError: () => false,
}));

const mockMakeRequest = jest.fn();
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  makeRequest: (...args) => mockMakeRequest(...args),
}));

jest.mock('../services/auditLogService', () => ({
  recordKillEvent: jest.fn().mockResolvedValue('audit-1'),
  recordKillFailure: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/agentLifecycleEvents', () => ({ emit: jest.fn() }));
jest.mock('../services/killSwitchSseHub', () => ({ publishStep: jest.fn() }));

jest.mock('../services/configStore', () => ({
  getEffective: (key) => ({
    PINGONE_AGENT_CLIENT_ID: 'app-agent-1',
    PINGONE_AI_AGENT_CLIENT_ID: 'app-agent-2',
  }[key]),
  get: () => null,
}));

const killSwitchService = require('../services/killSwitchService');

const TEN_MINUTES_MS = 10 * 60 * 1000;

beforeEach(() => {
  mockBacking.clear();
  mockNowMs = 1_700_000_000_000;
  // One clock for both sides: the store's expiry maths and the service's
  // dueAt/auto_reset_at must agree, or "10 minutes later" means two things.
  jest.spyOn(Date, 'now').mockImplementation(() => mockNowMs);
  mockMakeRequest.mockReset();
  // Stateful stand-in for PingOne: GET reports the app's current enabled
  // state, PUT writes it. Without the state, a GET that always says
  // enabled:true makes the re-enable path short-circuit as 'already_enabled'
  // and the test proves nothing.
  const appEnabled = new Map([['app-agent-1', true], ['app-agent-2', true]]);
  mockMakeRequest.mockImplementation((method, path, body) => {
    const id = path.split('/').pop();
    if (method === 'GET' && path.startsWith('/applications/')) {
      return Promise.resolve({ id, enabled: appEnabled.get(id), name: 'agent app' });
    }
    if (method === 'PUT' && path.startsWith('/applications/')) {
      appEnabled.set(id, body.enabled);
      return Promise.resolve({ id, enabled: body.enabled });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('kill switch auto-reset — the local block', () => {
  test('the revoked flag is written to last 10 minutes, not 24 hours', async () => {
    await killSwitchService.killAgent('agent-ttl', 'test', null, { accessToken: 'a' }, 'instance');

    const entry = mockBacking.get('agent:agent-ttl:revoked');
    expect(entry.sess.cookie.maxAge).toBe(TEN_MINUTES_MS);
  });

  test('the agent is blocked immediately, still blocked at 9 minutes, and free at 10', async () => {
    await killSwitchService.killAgent('agent-expiry', 'test', null, { accessToken: 'a' }, 'instance');

    expect(await killSwitchService.isAgentRevoked('agent-expiry')).toBe(true);

    mockNowMs += 9 * 60 * 1000;
    expect(await killSwitchService.isAgentRevoked('agent-expiry')).toBe(true);

    mockNowMs += 1 * 60 * 1000;
    expect(await killSwitchService.isAgentRevoked('agent-expiry')).toBe(false);
  });

  test('killAgent reports when the block lifts, so the UI can count down', async () => {
    const result = await killSwitchService.killAgent('agent-when', 'test', null, { accessToken: 'a' }, 'instance');

    expect(result.auto_reset_at).toBe(new Date(mockNowMs + TEN_MINUTES_MS).toISOString());
    expect(result.auto_reset_in_ms).toBe(TEN_MINUTES_MS);
  });
});

describe('kill switch auto-reset — the PingOne application disable', () => {
  test('a full-scope kill records a pending re-enable that outlives the revoked flag', async () => {
    await killSwitchService.killAgent('agent-full', 'test', 'user-1', { accessToken: 'a' }, 'full');

    const pending = mockBacking.get('agent:agent-full:app-reenable');
    expect(pending.sess.dueAt).toBe(mockNowMs + TEN_MINUTES_MS);
    // Must survive past the 10-minute revoked flag — otherwise the sweep can
    // never see it and the agent client stays disabled forever.
    expect(pending.sess.cookie.maxAge).toBeGreaterThan(TEN_MINUTES_MS);
  });

  test('an instance-scope kill records nothing — it never disabled an application', async () => {
    await killSwitchService.killAgent('agent-inst', 'test', 'user-1', { accessToken: 'a' }, 'instance');

    expect(mockBacking.get('agent:agent-inst:app-reenable')).toBeUndefined();
  });

  test('the sweep re-enables the applications once the record is due, and clears it', async () => {
    await killSwitchService.killAgent('agent-sweep', 'test', 'user-1', { accessToken: 'a' }, 'full');
    mockMakeRequest.mockClear();

    mockNowMs += TEN_MINUTES_MS;
    const swept = await killSwitchService.sweepDueAppReenables();

    expect(swept).toEqual(['agent:agent-sweep:app-reenable']);
    const puts = mockMakeRequest.mock.calls.filter(([method]) => method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts.every(([, , body]) => body.enabled === true)).toBe(true);
    expect(mockBacking.get('agent:agent-sweep:app-reenable')).toBeUndefined();
  });

  test('the sweep leaves a record that is not due yet alone', async () => {
    await killSwitchService.killAgent('agent-early', 'test', 'user-1', { accessToken: 'a' }, 'full');
    mockMakeRequest.mockClear();

    mockNowMs += 5 * 60 * 1000;
    const swept = await killSwitchService.sweepDueAppReenables();

    expect(swept).toEqual([]);
    expect(mockMakeRequest.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(0);
    expect(mockBacking.get('agent:agent-early:app-reenable')).toBeDefined();
  });

  test('the sweep never re-enables the PingOne user account', async () => {
    await killSwitchService.killAgent('agent-user', 'test', 'user-1', { accessToken: 'a' }, 'full');
    mockMakeRequest.mockClear();

    mockNowMs += TEN_MINUTES_MS;
    await killSwitchService.sweepDueAppReenables();

    const userWrites = mockMakeRequest.mock.calls.filter(([, path]) => path.startsWith('/users/'));
    expect(userWrites).toHaveLength(0);
  });

  test('one failing application does not strand the record — it stays for the next sweep', async () => {
    await killSwitchService.killAgent('agent-fail', 'test', 'user-1', { accessToken: 'a' }, 'full');
    mockMakeRequest.mockReset();
    mockMakeRequest.mockRejectedValue(new Error('PingOne unreachable'));

    mockNowMs += TEN_MINUTES_MS;
    const swept = await killSwitchService.sweepDueAppReenables();

    expect(swept).toEqual([]);
    expect(mockBacking.get('agent:agent-fail:app-reenable')).toBeDefined();
  });
});
