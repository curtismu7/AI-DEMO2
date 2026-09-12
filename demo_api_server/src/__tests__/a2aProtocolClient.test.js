'use strict';

/**
 * The generalist's half of the A2A wire hop.
 *
 * The hop carries the Exchange #1 DELEGATED token — no client_credentials
 * bearer is minted — and the in-process path runs the SAME PingOne gate the
 * HTTP route does, so it is not a way around it.
 *
 * The specialist's own two legs (Exchange #2, the tool call) are mocked so
 * these tests drive the REAL @a2a-js handler and executor without a PingOne
 * tenant or a gateway.
 */

jest.mock('../../middleware/a2aPingOneBearer', () => ({ verifyA2aBearer: jest.fn() }));
jest.mock('../../services/a2aDelegationService', () => ({
  ...jest.requireActual('../../services/a2aDelegationService'),
  exchangeAsSpecialist: jest.fn(),
}));
jest.mock('../../services/bffMcpToolExecutor', () => ({ executeBffToolWithToken: jest.fn() }));
// Only cardVerifier is replaceable, and it DELEGATES TO THE REAL ONE by default
// (see beforeEach) so every other case still exercises genuine sign/verify
// interop. Overriding it is the only way to reach the card fail-closed leg: the
// client destructures cardVerifier at module load, so jest.spyOn on the module
// object afterwards would never be seen.
jest.mock('../../services/a2aCardSigningService', () => ({
  ...jest.requireActual('../../services/a2aCardSigningService'),
  cardVerifier: jest.fn(),
}));

const { verifyA2aBearer } = require('../../middleware/a2aPingOneBearer');
const { exchangeAsSpecialist } = require('../../services/a2aDelegationService');
const { executeBffToolWithToken } = require('../../services/bffMcpToolExecutor');
const { cardVerifier } = require('../../services/a2aCardSigningService');
const realCardSigning = jest.requireActual('../../services/a2aCardSigningService');
const { sendA2aProtocolHandoff } = require('../../services/a2aProtocolClient');
const { specialistForVertical } = require('../../config/a2aSpecialists');

const CFG = { getEffective: () => '' };
const TOOL = specialistForVertical('investment').tools[0];

describe('a2aProtocolClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Real verification by default; only the negative case below overrides it.
    cardVerifier.mockImplementation(realCardSigning.cardVerifier);
  });

  test('sends the delegated token and mints no client_credentials bearer', async () => {
    verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
    const oauthService = { getAiAgentClientCredentialsToken: jest.fn() };
    const tokenEvents = [];

    await sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'positions',
      subjectToken: 'T.AGENT1',
      tokenEvents,
      cfg: CFG,
      deps: { oauthService },
    });

    expect(oauthService.getAiAgentClientCredentialsToken).not.toHaveBeenCalled();
    expect(verifyA2aBearer).toHaveBeenCalledWith('T.AGENT1', expect.objectContaining({ vertical: 'investment' }));
    const bearerEvent = tokenEvents.find((e) => e.id === 'a2a-protocol-bearer');
    expect(bearerEvent.status).toBe('acquired');
  });

  test('fails the hop when the bearer does not validate (no soft-fail)', async () => {
    verifyA2aBearer.mockRejectedValue(new Error('unauthorized'));
    const tokenEvents = [];
    const out = await sendA2aProtocolHandoff({
      vertical: 'investment', subtask: 'positions', subjectToken: 'BAD', tokenEvents, cfg: CFG,
    });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unauthorized/i);
    expect(tokenEvents.some((e) => e.status === 'failed')).toBe(true);
  });

  test('requires a delegated token to be supplied', async () => {
    const out = await sendA2aProtocolHandoff({ vertical: 'investment', tokenEvents: [], cfg: CFG });
    expect(out.ok).toBe(false);
  });

  // Ruling 5 — the security point of the whole change. The in-process path used
  // to `void bearer` and never call the validator, so anything that could reach
  // this function reached the specialist's tool. An invalid bearer must stop
  // before Exchange #2 and before the tool call, exactly as the HTTP 401 does.
  test('an invalid bearer on the IN-PROCESS path runs no exchange and no tool', async () => {
    verifyA2aBearer.mockRejectedValue(new Error('invalid_token'));
    const tokenEvents = [];

    const out = await sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'positions',
      tool: TOOL,
      toolArgs: {},
      subjectToken: 'FORGED.TOKEN',
      tokenEvents,
      cfg: CFG,
    });

    expect(out.ok).toBe(false);
    expect(out.code).toBe('a2a_unauthorized');
    expect(exchangeAsSpecialist).not.toHaveBeenCalled();
    expect(executeBffToolWithToken).not.toHaveBeenCalled();
  });

  test('maps the specialist data-only reply back onto the hop result', async () => {
    verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
    exchangeAsSpecialist.mockResolvedValue({
      token: 'T.NESTED', claims: { sub: 'u1' }, actChainDepth: 2, scopes: ['holdings:read'],
    });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ holdings: [{ symbol: 'VTI' }] }));
    const tokenEvents = [];

    const out = await sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'review my holdings',
      tool: TOOL,
      toolArgs: { account_id: 'acct-1' },
      subjectToken: 'T.AGENT1',
      tokenEvents,
      cfg: CFG,
      req: { sessionID: 's1' },
      sessionId: 's1',
    });

    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ holdings: [{ symbol: 'VTI' }] });
    expect(out.toolError).toBeNull();
    expect(out.actChainDepth).toBe(2);
    expect(out.scopes).toEqual(['holdings:read']);

    // The delegated token is the hop's subject token, and the tool ran under the
    // nested-act token the SPECIALIST minted.
    expect(exchangeAsSpecialist).toHaveBeenCalledWith(
      'T.AGENT1', expect.objectContaining({ vertical: 'investment', tool: TOOL }),
    );
    expect(executeBffToolWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: TOOL, suppliedToken: 'T.NESTED' }),
    );

    // The three wire events the UI and UC2.7 declare.
    expect(tokenEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining(['a2a-protocol-bearer', 'a2a-agent-card', 'a2a-protocol-message']),
    );
    // No credential may appear in the token chain.
    expect(JSON.stringify(tokenEvents)).not.toMatch(/T\.NESTED|T\.AGENT1/);
  });

  // The card leg must fail CLOSED, for the same reason the bearer leg must: an
  // unenforced check sitting behind a green suite is how the `void bearer;` gap
  // survived. With the real verifier this leg always succeeds, so nothing else
  // in this file would notice if verification stopped being fatal.
  test('a card whose signature does not verify fails the hop closed', async () => {
    verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
    cardVerifier.mockReturnValue(async () => {
      throw new Error('refusing foreign jku https://evil.example/.well-known/jwks.json');
    });
    const tokenEvents = [];

    const out = await sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'review my holdings',
      tool: TOOL,
      toolArgs: {},
      subjectToken: 'T.AGENT1',
      tokenEvents,
      cfg: CFG,
      req: { sessionID: 's1' },
      sessionId: 's1',
    });

    expect(out.ok).toBe(false);
    expect(out.code).toBe('a2a_card_signature');
    expect(out.error).toMatch(/jku/i);
    // Nothing ran: no Exchange #2, no tool call.
    expect(exchangeAsSpecialist).not.toHaveBeenCalled();
    expect(executeBffToolWithToken).not.toHaveBeenCalled();
    // It is the CARD leg that stopped it — the bearer gate had already passed.
    expect(tokenEvents.some((e) => e.id === 'a2a-protocol-bearer' && e.status === 'acquired')).toBe(true);
    expect(tokenEvents.some((e) => e.id === 'a2a-agent-card' && e.status === 'failed')).toBe(true);
  });

  describe('time bounds', () => {
    const OLD_BOUND_MS = 5000; // the bound before the specialist's work moved inside it

    const hop = (tokenEvents) => sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'review my holdings',
      tool: TOOL,
      toolArgs: {},
      subjectToken: 'T.AGENT1',
      tokenEvents,
      cfg: CFG,
      req: { sessionID: 's1' },
      sessionId: 's1',
    });

    afterEach(() => jest.useRealTimers());

    // THE REGRESSION THIS FIX EXISTS FOR. The hop now contains the specialist's
    // Exchange #2, which a2aDelegationService budgets at attempts × 30s. At the
    // old 5s ceiling this working path was cut off and reported as
    // a2a_exchange2_failed — a false failure.
    test('a hop slower than the old 5s bound still succeeds', async () => {
      jest.useFakeTimers();
      verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
      exchangeAsSpecialist.mockImplementation(
        () => new Promise((resolve) => {
          setTimeout(
            () => resolve({ token: 'T.NESTED', claims: { sub: 'u1' }, actChainDepth: 2, scopes: ['holdings:read'] }),
            OLD_BOUND_MS * 4, // 20s: past the old bound, inside the exchange budget
          );
        }),
      );
      executeBffToolWithToken.mockResolvedValue(JSON.stringify({ holdings: [{ symbol: 'VTI' }] }));

      const tokenEvents = [];
      const pending = hop(tokenEvents);
      await jest.advanceTimersByTimeAsync(OLD_BOUND_MS * 4 + 1);
      const out = await pending;

      expect(out.ok).toBe(true);
      expect(out.result).toEqual({ holdings: [{ symbol: 'VTI' }] });
      expect(out.actChainDepth).toBe(2);
    });

    // The old suite pinned that a stalled bearer MINT could not hang the A2A use
    // case. The mint is gone; the guarantee is not. A hop that never settles must
    // still end as a bounded failure.
    test('a stalled hop is bounded, not hung', async () => {
      jest.useFakeTimers();
      verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
      exchangeAsSpecialist.mockImplementation(() => new Promise(() => {}));

      const tokenEvents = [];
      const pending = hop(tokenEvents);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      const out = await pending;

      expect(out.ok).toBe(false);
      expect(out.code).toBe('a2a_exchange2_failed');
      expect(out.error).toMatch(/timed out/i);
      expect(tokenEvents.some((e) => e.id === 'a2a-protocol-message' && e.status === 'failed')).toBe(true);
    });

    // The quick legs keep the original 5s bound: a stalled PingOne JWKS fetch
    // must not inherit the long SendMessage ceiling.
    test('a stalled bearer validation fails at the short gate bound', async () => {
      jest.useFakeTimers();
      verifyA2aBearer.mockImplementation(() => new Promise(() => {}));

      const tokenEvents = [];
      const pending = hop(tokenEvents);
      await jest.advanceTimersByTimeAsync(OLD_BOUND_MS + 1);
      const out = await pending;

      expect(out.ok).toBe(false);
      expect(out.code).toBe('a2a_unauthorized');
      expect(out.error).toMatch(/timed out/i);
      expect(exchangeAsSpecialist).not.toHaveBeenCalled();
    });
  });
});
