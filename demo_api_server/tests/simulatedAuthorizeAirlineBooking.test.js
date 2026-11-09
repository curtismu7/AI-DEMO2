'use strict';

/**
 * Airline booking rules - simulatedAuthorizeService.evaluateMcpFirstTool.
 *
 *   RULE A (the user's preference): no tickets bought by an AI agent over $500 (the user's limit).
 *   RULE B (the airline's control): only premium members can book over $750.
 *
 * Parity with demo_authz_server/routes/decision.js Rule 3-airline and the cloud rules. Both strict
 * `>`; every failing rule is reported (statements, A first).
 *
 * The member tier is the PingOne USER's custom attribute airlineMemberTier, read from a mock user record
 * keyed by the token subject (userId), never passed in the request. A subject with no record or no value
 * is NOT premium.
 */

jest.mock('../services/configStore', () => ({
  get: jest.fn(),
  getEffective: jest.fn(),
  setRaw: jest.fn(),
}));

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const configStore = require('../services/configStore');
const { evaluateMcpFirstTool, setMockPingOneUser, clearMockPingOneUsers } = require('../services/simulatedAuthorizeService');

const DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'demo_mcp_resource_server', 'seed', 'airline-booking-policy-data.json'), 'utf8'));

const CODE_A = 'mcp-airline-agent-spend-limit';
const CODE_B = 'mcp-airline-premium-only';
const PREMIUM = 'Premier Gold';
const STANDARD = 'Premier Silver';

const BASE = {
  userId: 'u-air',
  toolName: 'book_airline_flight',
  tokenAudience: 'https://mcp.example',
  acr: '',
};
// `tier` is the airlineMemberTier of the calling user: undefined/null = a user with NO such attribute.
function userWith(tier) {
  const userId = `u-${tier == null ? 'no-tier' : tier === '' ? 'empty-tier' : String(tier).replace(/\s+/g, '-')}`;
  if (tier != null) setMockPingOneUser(userId, { airlineMemberTier: tier });
  return userId;
}
const agent = (amount, tier, extra = {}) => ({ ...BASE, userId: userWith(tier), actClientId: 'agent-1', amount, ...extra });
const direct = (amount, tier, extra = {}) => ({ ...BASE, userId: userWith(tier), actClientId: '', amount, ...extra });
const codes = (r) => (r.raw.statements || []).map((s) => s.code);

beforeEach(() => {
  clearMockPingOneUsers();
  configStore.get.mockImplementation(() => null);
  configStore.getEffective.mockImplementation(() => null);
});

describe('airline booking rules (simulated engine)', () => {
  it.each([
    ['1 agent 480 standard', () => agent(480, STANDARD), []],
    ['2 agent 500 standard (not over 500)', () => agent(500, STANDARD), []],
    ['3 agent 620 standard', () => agent(620, STANDARD), [CODE_A]],
    ['4 agent 940 premium', () => agent(940, PREMIUM), [CODE_A]],
    ['5 direct 620 standard', () => direct(620, STANDARD), []],
    ['6 direct 750 standard (not over 750)', () => direct(750, STANDARD), []],
    ['7 direct 940 standard', () => direct(940, STANDARD), [CODE_B]],
    ['8 direct 940 premium', () => direct(940, PREMIUM), []],
    ['9 agent 940 standard', () => agent(940, STANDARD), [CODE_A, CODE_B]],
  ])('matrix %s', async (_label, params, expected) => {
    const r = await evaluateMcpFirstTool(params());
    if (expected.length === 0) {
      expect(r.decision).not.toBe('DENY');
    } else {
      expect(r.decision).toBe('DENY');
      expect(codes(r)).toEqual(expected);
    }
  });

  it('boundaries: 500.01 by an agent and 750.01 by a standard direct caller are denied', async () => {
    expect(codes(await evaluateMcpFirstTool(agent(500.01, STANDARD)))).toEqual([CODE_A]);
    expect(codes(await evaluateMcpFirstTool(direct(750.01, STANDARD)))).toEqual([CODE_B]);
    expect((await evaluateMcpFirstTool(direct(750, STANDARD))).decision).not.toBe('DENY');
  });

  it('follows the user preference: agentSpendLimit 800 passes 620 and denies 940', async () => {
    expect((await evaluateMcpFirstTool(agent(620, STANDARD, { agentSpendLimit: 800 }))).decision).not.toBe('DENY');
    expect(codes(await evaluateMcpFirstTool(agent(940, PREMIUM, { agentSpendLimit: 800 })))).toEqual([CODE_A]);
  });

  it('a missing or garbage limit falls back to 500, a missing tier is not premium', async () => {
    for (const bad of [null, undefined, '', 'abc', NaN]) {
      expect(codes(await evaluateMcpFirstTool(agent(620, STANDARD, { agentSpendLimit: bad })))).toEqual([CODE_A]);
    }
    expect(codes(await evaluateMcpFirstTool(direct(940, null)))).toEqual([CODE_B]);
  });

  it('a user with no airlineMemberTier, an empty one or an unknown one is not premium; a MemberTier in the request is ignored', async () => {
    for (const tier of [undefined, null, '', 'none', 'Premier Platinum', 'premier gold']) {
      expect(codes(await evaluateMcpFirstTool(direct(940, tier)))).toEqual([CODE_B]);
    }
    expect(codes(await evaluateMcpFirstTool({ ...direct(940, STANDARD), memberTier: PREMIUM, MemberTier: PREMIUM }))).toEqual([CODE_B]);
    expect((await evaluateMcpFirstTool({ ...direct(940, PREMIUM), memberTier: 'none' })).decision).not.toBe('DENY');
    // Flipping the user record flips the decision for the same request (the demo's 'set the tier to Silver').
    const req = direct(940, PREMIUM);
    expect((await evaluateMcpFirstTool(req)).decision).not.toBe('DENY');
    setMockPingOneUser(req.userId, { airlineMemberTier: STANDARD });
    expect(codes(await evaluateMcpFirstTool(req))).toEqual([CODE_B]);
  });

  it('the premium tier set matches the shared data file', async () => {
    for (const tier of DATA.premiumTiers) {
      expect((await evaluateMcpFirstTool(direct(940, tier))).decision).not.toBe('DENY');
    }
    expect(codes(await evaluateMcpFirstTool(direct(940, 'Premier Platinum')))).toEqual([CODE_B]);
  });

  it('other tools are unaffected', async () => {
    const r = await evaluateMcpFirstTool({ ...BASE, toolName: 'get_airline_bookings', userId: userWith(STANDARD), actClientId: 'agent-1', amount: 940 });
    expect(codes(r)).not.toContain(CODE_A);
    expect(codes(r)).not.toContain(CODE_B);
  });
});
