'use strict';

/**
 * MCP spec 2026-07-28 MRTR: the ELICITATION obligation's server-initiated
 * input request, for a caller that declared Modern _meta. This is the LIVE,
 * regression-protected transfer-consent flow's HTTP-transport path
 * (authorizeMcpRequest.ts) — the Legacy shape (elicitation_required error +
 * _elicitation_confirmed re-call) is UNCHANGED and untested here; see
 * authorizeMcpRequest.elicitation.test.ts for that coverage, which stays
 * green throughout this file's existence, proving Legacy callers are
 * unaffected.
 *
 * Reuses the exact same elicitationStore.ts record (crypto-random,
 * one-time-use, session+tool-bound, TTL-bound) as `requestState` — already
 * satisfies the spec's requestState integrity requirement (unforgeable,
 * single-use, principal-bound, server-validated) without a redundant HMAC
 * layer on top of an already-unguessable UUID.
 */

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { _resetElicitationStoreForTest } from '../src/elicitationStore';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

beforeEach(() => _resetElicitationStoreForTest());

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const headCalls: Array<{ status: number }> = [];
  return {
    res: {
      writeHead: jest.fn((status: number) => { headCalls.push({ status }); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    status: () => headCalls[0]?.status,
  };
}

const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };

/** Drive the HTTP middleware with an injected decision and return what went out. */
async function runWith(
  authorize: () => Promise<any>,
  opts: {
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    sessionId?: string;
    modern?: boolean;
    inputResponses?: Record<string, unknown>;
    requestState?: string;
  } = {},
) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'write transfer' }),
    authorize,
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const harness = makeRes();
  const params: Record<string, unknown> = { name: opts.toolName ?? 'create_withdrawal', arguments: opts.toolArgs ?? {} };
  if (opts.modern) params._meta = MODERN_META;
  if (opts.inputResponses) params.inputResponses = opts.inputResponses;
  if (opts.requestState) params.requestState = opts.requestState;
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params };
  const forwarded: string[] = [];
  const headers: Record<string, string> = {};
  if (opts.sessionId) headers['mcp-session-id'] = opts.sessionId;
  await middleware('tok', Buffer.from(JSON.stringify(rpc)),
    { headers, socket: {} } as any, harness.res, async (_upstreamToken, fwdBody) => { forwarded.push(fwdBody.toString('utf-8')); });
  return { ...harness, forwarded };
}

const elicitationAuthorize = async () => ({
  decision: 'INDETERMINATE',
  reason: 'HITL_REQUIRED',
  obligation: 'elicitation',
  policySource: 'p1az',
  advice: [{ id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' }],
});

const withdrawalArgs = { from_account_id: 'acct-1', amount: 100 };

describe('MRTR — ELICITATION obligation mint (Modern caller)', () => {
  it('returns an InputRequiredResult, not the Legacy elicitation_required error', async () => {
    const { body, forwarded } = await runWith(elicitationAuthorize, {
      sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true,
    });
    expect(forwarded).toHaveLength(0);
    const b = body();
    expect(b.jsonrpc).toBe('2.0');
    expect(b.error).toBeUndefined();
    expect(b.result.resultType).toBe('input_required');
    expect(b.result.inputRequests.elicitation).toEqual({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'Confirm create_withdrawal?',
        requestedSchema: { type: 'object', properties: {} },
      },
    });
    expect(typeof b.result.requestState).toBe('string');
  });

  it('does not touch the Legacy shape when the caller has no Modern _meta', async () => {
    const { body } = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs });
    expect(body().error).toBe('elicitation_required');
    expect(body().result).toBeUndefined();
  });
});

describe('MRTR — ELICITATION retry with inputResponses (Modern caller)', () => {
  it('accepting forwards the original tool call and consumes the requestState (one-time use)', async () => {
    const mint = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true });
    const requestState = mint.body().result.requestState;

    const confirmAuthorize = jest.fn(async () => ({ decision: 'PERMIT', policySource: 'p1az' }));
    const confirm = await runWith(confirmAuthorize, {
      sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true,
      inputResponses: { elicitation: { action: 'accept' } },
      requestState,
    });
    expect(confirm.forwarded).toHaveLength(1);
    const forwardedBody = JSON.parse(confirm.forwarded[0]);
    // Internal MRTR fields must not leak to the backend, same discipline as
    // the Legacy _elicitation_confirmed/_elicitation_id stripping.
    expect(forwardedBody.params.inputResponses).toBeUndefined();
    expect(forwardedBody.params.requestState).toBeUndefined();
    // The PDP call sees the same confirmation flag the Legacy path uses —
    // reuses the identical P1AZ contract, no new obligation type needed.
    expect((confirmAuthorize.mock.calls[0] as any[])[3]).toEqual(
      expect.objectContaining({ _elicitation_confirmed: true }),
    );

    // Second use of the same requestState is rejected — one-time use, same
    // store as Legacy.
    const replay = await runWith(async () => ({ decision: 'PERMIT', policySource: 'p1az' }), {
      sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true,
      inputResponses: { elicitation: { action: 'accept' } },
      requestState,
    });
    expect(replay.forwarded).toHaveLength(0);
  });

  it('declining does not forward the tool call', async () => {
    const mint = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true });
    const requestState = mint.body().result.requestState;

    const declineAuthorize = jest.fn(elicitationAuthorize);
    const decline = await runWith(declineAuthorize, {
      sessionId: 'sess-1', toolArgs: withdrawalArgs, modern: true,
      inputResponses: { elicitation: { action: 'decline' } },
      requestState,
    });
    expect(decline.forwarded).toHaveLength(0);
  });
});
