'use strict';

/**
 * MRTR requestState on the HTTP transport (MCP 2026-07-28): a Modern caller has
 * no Mcp-Session-Id, so requestState is a signed token bound to tool +
 * principal + arguments, expiring and single-use (requestState.ts).
 *
 * authorizeMcpRequest.mrtr.test.ts covers the happy path; this file covers what
 * the binding is for — each of these retries must be refused and must not
 * reach the backend.
 */

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { createPendingElicitation, _resetElicitationStoreForTest } from '../src/elicitationStore';
import { _resetRequestStateForTest } from '../src/requestState';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

beforeEach(() => {
  process.env.GW_REQUEST_STATE_SECRET = 'unit-test-secret-0123456789';
  _resetElicitationStoreForTest();
  _resetRequestStateForTest();
});
afterEach(() => {
  delete process.env.GW_REQUEST_STATE_SECRET;
  _resetRequestStateForTest();
});

function makeRes() {
  const chunks: string[] = [];
  const statuses: number[] = [];
  return {
    res: {
      writeHead: jest.fn((status: number) => { statuses.push(status); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    status: () => statuses[0],
  };
}

const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
const args = { from_account_id: 'acct-1', amount: 100 };

interface Opts {
  sub?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  sessionId?: string;
  modern?: boolean;
  inputResponses?: Record<string, unknown>;
  requestState?: string;
  legacyMarkers?: Record<string, unknown>;
}

async function run(authorize: () => Promise<any>, opts: Opts = {}) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: opts.sub ?? 'u1', exp: 9999999999, scope: 'write transfer' }),
    authorize,
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const harness = makeRes();
  const params: Record<string, unknown> = {
    name: opts.toolName ?? 'create_withdrawal',
    arguments: { ...(opts.toolArgs ?? args), ...(opts.legacyMarkers ?? {}) },
  };
  if (opts.modern !== false) params._meta = MODERN_META;
  if (opts.inputResponses) params.inputResponses = opts.inputResponses;
  if (opts.requestState) params.requestState = opts.requestState;
  const forwarded: string[] = [];
  const headers: Record<string, string> = {};
  if (opts.sessionId) headers['mcp-session-id'] = opts.sessionId;
  await middleware('tok', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params })),
    { headers, socket: {} } as any, harness.res, async (_t, fwd) => { forwarded.push(fwd.toString('utf-8')); });
  return { ...harness, forwarded };
}

const elicit = async () => ({
  decision: 'INDETERMINATE', reason: 'HITL_REQUIRED', obligation: 'elicitation', policySource: 'p1az',
  advice: [{ id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' }],
});
const permit = async () => ({ decision: 'PERMIT', policySource: 'p1az' });
const accept = { elicitation: { action: 'accept' } };

async function mint(opts: Opts = {}): Promise<string> {
  const r = await run(elicit, opts);
  return r.body().result.requestState as string;
}

describe('MRTR requestState — signed, stateless', () => {
  it('mints a signed token and works with no Mcp-Session-Id at all', async () => {
    const requestState = await mint();
    expect(requestState.startsWith('gw1.')).toBe(true);
    const retry = await run(permit, { inputResponses: accept, requestState });
    expect(retry.forwarded).toHaveLength(1);
  });

  it('does not depend on the session id: a different one on the retry still redeems', async () => {
    const requestState = await mint({ sessionId: 'sess-A' });
    const retry = await run(permit, { sessionId: 'sess-B', inputResponses: accept, requestState });
    expect(retry.forwarded).toHaveLength(1);
  });

  it('redeems once only', async () => {
    const requestState = await mint();
    expect((await run(permit, { inputResponses: accept, requestState })).forwarded).toHaveLength(1);
    const replay = await run(permit, { inputResponses: accept, requestState });
    expect(replay.forwarded).toHaveLength(0);
    expect(replay.status()).toBe(403);
    expect(replay.body().reason).toBe('invalid_or_expired');
  });
});

describe('MRTR requestState — what the binding refuses', () => {
  const refused = async (opts: Opts, requestState: string) => {
    const authorize = jest.fn(permit);
    const retry = await run(authorize, { inputResponses: accept, requestState, ...opts });
    expect(retry.forwarded).toHaveLength(0);
    expect(retry.status()).toBe(403);
    // The reason, not just the status: a schema or scope rejection must not pass for a binding rejection.
    expect(retry.body().reason).toBe('invalid_or_expired');
    expect(authorize).not.toHaveBeenCalled();
  };

  it('another principal presenting the token', async () => {
    await refused({ sub: 'u2' }, await mint({ sub: 'u1' }));
  });

  it('the same principal with changed arguments (approve 100, send 100000)', async () => {
    await refused({ toolArgs: { ...args, amount: 100000 } }, await mint());
  });

  it('a different tool that takes the same arguments (approve deposit, redeem on withdraw)', async () => {
    const sameShape = { amount: 100, portfolioType: 'checking' };
    const requestState = await mint({ toolName: 'deposit', toolArgs: sameShape });
    await refused({ toolName: 'withdraw', toolArgs: sameShape }, requestState);
  });

  it('a tampered token', async () => {
    const t = await mint();
    await refused({}, `${t.slice(0, -3)}AAA`);
  });

  it('a Legacy elicitation_id offered as requestState', async () => {
    const legacy = createPendingElicitation('create_withdrawal', '', 'Confirm?');
    await refused({}, legacy.elicitation_id);
  });

  it('a signed token offered through the Legacy _elicitation_id marker', async () => {
    const requestState = await mint();
    const authorize = jest.fn(permit);
    const retry = await run(authorize, {
      modern: false,
      legacyMarkers: { _elicitation_confirmed: true, _elicitation_id: requestState },
    });
    expect(retry.forwarded).toHaveLength(0);
    expect(retry.status()).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('a declined elicitation leaves the token unredeemed for a later accept', async () => {
    const requestState = await mint();
    await run(elicit, { inputResponses: { elicitation: { action: 'decline' } }, requestState });
    const accepted = await run(permit, { inputResponses: accept, requestState });
    expect(accepted.forwarded).toHaveLength(1);
  });
});

describe('Legacy elicitation is untouched', () => {
  it('still mints a store-backed elicitation_id (not a signed token) for a caller without Modern _meta', async () => {
    const r = await run(elicit, { modern: false, sessionId: 'sess-1' });
    expect(r.body().error).toBe('elicitation_required');
    expect(r.body().elicitation_id).not.toMatch(/^gw1\./);
  });
});
