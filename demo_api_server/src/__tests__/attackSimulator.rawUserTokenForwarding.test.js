'use strict';
/**
 * raw-user-token-forwarding (UC16b) — Zero-Trust token custody demo sim.
 *
 * What must be proven (chip-correctness: real values, not just non-error):
 *   1. The sim self-arms ff_skip_token_exchange, runs the PRODUCTION resolver,
 *      and returns the real block: status 403 + user_token_forwarding_disabled.
 *   2. The chain carries the user-token root AND the exchange-skipped event the
 *      guard emits (the declared evidence in useCases.js UC16b).
 *   3. The flag is restored to its exact prior value after the run — including
 *      when the resolver throws (finally-path guarantee, no state leak).
 *   4. If the resolver fails to block, the sim reports unexpected_permit —
 *      it never fabricates a DENY the control did not produce.
 */

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
  setRaw: jest.fn(async () => {}),
}));

jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(),
  buildTokenEvent: jest.fn((id, label, status, claims, explanation) => ({
    id, label, status, claims, explanation,
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-1' } })),
}));

jest.mock('../../services/nrSegments', () => ({
  attackSimVerdict: jest.fn(async (fn) => fn()),
}));

jest.mock('../../services/useCaseTagging', () => ({
  stampUseCaseId: jest.fn((events, useCaseId) => {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || ev.useCaseId) continue;
      if (ev.id === 'user-token') continue; // SESSION_EVENT_IDS skip
      ev.useCaseId = useCaseId;
    }
    return events;
  }),
}));

// setup.js afterEach runs jest.resetModules(), so top-level requires go stale
// after the first test — the documented trap (agentPreflightService.js's
// lazy-require comment). Re-require INSIDE each test against the fresh registry.
const REQ = { session: { oauthTokens: { accessToken: 'user.raw.token' } } };

function mocks() {
  return {
    configStore: require('../../services/configStore'),
    resolver: require('../../services/agentMcpTokenService').resolveMcpAccessTokenWithEvents,
    runAttackSim: require('../../services/attackSimulatorService').runAttackSim,
  };
}

function blockedResolution(overrides = {}) {
  return {
    token: null,
    tokenEvents: [{
      id: 'exchange-skipped',
      label: 'Token Exchange (RFC 8693) — Raw user token blocked',
      status: 'failed',
      useCaseId: 'raw-user-token-forwarding-blocked',
    }],
    userSub: 'user-1',
    tratContextHeader: null,
    blocked: true,
    blockCode: 'user_token_forwarding_disabled',
    blockMessage: 'Raw user-token forwarding to MCP is disabled. Use RFC 8693 token exchange instead.',
    blockHttpStatus: 403,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const { configStore } = mocks();
  configStore.getEffective.mockReturnValue('false');
  configStore.setRaw.mockClear();
});

describe('runAttackSim(raw-user-token-forwarding) — UC16b', () => {
  test('returns the real block: 403 + user_token_forwarding_disabled', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockResolvedValueOnce(blockedResolution());

    const result = await runAttackSim('raw-user-token-forwarding', REQ);

    expect(result.sim).toBe('raw-user-token-forwarding');
    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('user_token_forwarding_disabled');
    expect(result.useCaseId).toBe('raw-user-token-forwarding-blocked');
    // The PRODUCTION resolver was exercised, not a mock deny path
    expect(resolver).toHaveBeenCalledWith(REQ, 'get_my_accounts');
  });

  test('chain carries user-token root AND exchange-skipped (declared UC16b evidence)', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockResolvedValueOnce(blockedResolution());

    const result = await runAttackSim('raw-user-token-forwarding', REQ);
    const ids = result.tokenChainEvents.map((e) => e.id);

    expect(ids).toContain('user-token');
    expect(ids).toContain('exchange-skipped');
    expect(ids).toContain('sim-forwarding-blocked');
  });

  test('self-arms ff_skip_token_exchange and RESTORES the exact prior value', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockResolvedValueOnce(blockedResolution());

    await runAttackSim('raw-user-token-forwarding', REQ);

    const setCalls = configStore.setRaw.mock.calls;
    expect(setCalls.length).toBe(2);
    expect(setCalls[0][0]).toEqual({ ff_skip_token_exchange: 'true' });
    expect(setCalls[0][1]).toEqual({ persist: false }); // in-memory only, LMDB untouched
    expect(setCalls[1][0]).toEqual({ ff_skip_token_exchange: 'false' }); // prior value restored
    expect(setCalls[1][1]).toEqual({ persist: false });
  });

  test('restores the flag even when the resolver THROWS', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockRejectedValueOnce(new Error('resolver exploded'));

    const result = await runAttackSim('raw-user-token-forwarding', REQ);

    const setCalls = configStore.setRaw.mock.calls;
    expect(setCalls.length).toBe(2);
    expect(setCalls[1][0]).toEqual({ ff_skip_token_exchange: 'false' });
    // A throw without a block must NOT be reported as a DENY
    expect(result.errorCode).not.toBe('user_token_forwarding_disabled');
    expect(result.status).toBe(200); // unexpected path, honestly reported
    expect(result.errorCode).toBe('unexpected_allow');
  });

  test('an armed flag that was ALREADY true is restored to true (not clobbered to false)', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('true');
    resolver.mockResolvedValueOnce(blockedResolution());

    await runAttackSim('raw-user-token-forwarding', REQ);

    const setCalls = configStore.setRaw.mock.calls;
    expect(setCalls[1][0]).toEqual({ ff_skip_token_exchange: 'true' });
  });

  test('a resolver that fails to block is reported as unexpected_allow, never a fabricated DENY', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockResolvedValueOnce(
      blockedResolution({ blocked: false, blockCode: null, token: 'some-token', blockHttpStatus: null })
    );

    const result = await runAttackSim('raw-user-token-forwarding', REQ);

    expect(result.status).toBe(200);
    expect(result.errorCode).toBe('unexpected_allow');
    const warnEvent = result.tokenChainEvents.find((e) => e.id === 'sim-forwarding-unexpected-allow'
      || e.id === 'sim-forwarding-blocked');
    // No blocked event may exist when the resolver did not block
    expect(result.tokenChainEvents.find((e) => e.id === 'sim-forwarding-blocked')).toBeUndefined();
    expect(warnEvent).toBeDefined();
  });

  test('every chain event is stamped with the useCaseId', async () => {
    const { configStore, resolver, runAttackSim } = mocks();
    configStore.getEffective.mockReturnValue('false');
    resolver.mockResolvedValueOnce(blockedResolution());

    const result = await runAttackSim('raw-user-token-forwarding', REQ);

    // user-token is a session card — stampUseCaseId intentionally never stamps it
    // (SESSION_EVENT_IDS). Every other event must carry the useCaseId.
    result.tokenChainEvents.forEach((ev) => {
      if (ev.id === 'user-token') return;
      expect(ev.useCaseId).toBe('raw-user-token-forwarding-blocked');
    });
  });
});
