'use strict';

/**
 * authorizeMcpRequest.elicitation.test.ts — HTTP-transport parity for the
 * ELICITATION obligation.
 *
 * The WS path (index.ts handleMessage, see tests/elicitation.test.ts for the
 * obligation-dispatch layer) already mints a pending elicitation record and
 * answers -32003 elicitation_required. This deployment routes tool calls over
 * HTTP (MCP_GATEWAY_HTTP_URL configured — see demo_api_server/utils/
 * mcpToolRegistry.js), so the HTTP middleware needs the same obligation
 * branch and re-call validation, sharing the same pending-elicitation store
 * (src/elicitationStore.ts) so a record minted on either transport is
 * consumable on either.
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

/** Drive the HTTP middleware with an injected decision and return what went out. */
async function runWith(
  authorize: () => Promise<any>,
  opts: { toolName?: string; toolArgs?: Record<string, unknown>; sessionId?: string } = {},
) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'write transfer' }),
    authorize,
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const harness = makeRes();
  const rpc = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: opts.toolName ?? 'create_withdrawal', arguments: opts.toolArgs ?? {} },
  };
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
const transferArgs = { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 100 };

describe('HTTP path — ELICITATION obligation mint', () => {
  it('returns elicitation_required with a prompt and elicitation_id, not a generic HITL challenge', async () => {
    const { body, forwarded } = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs });
    expect(forwarded).toHaveLength(0);
    expect(body().error).toBe('elicitation_required');
    expect(body().elicitation_id).toEqual(expect.any(String));
    expect(body().prompt).toBe('Confirm create_withdrawal?');
    expect(body().tool_name).toBe('create_withdrawal');
    expect(body().expires_in).toBe(120);
    // Not the generic HITL shape — no challengeId minted for this obligation.
    expect(body().challengeId).toBeUndefined();
  });

  it('carries policy_source provenance like every other decision', async () => {
    const { body } = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs });
    expect(body().policy_source).toBe('p1az');
  });

  it('falls back to a generic prompt when no elicitation-prompt advice is present', async () => {
    const { body } = await runWith(async () => ({
      decision: 'INDETERMINATE',
      reason: 'HITL_REQUIRED',
      obligation: 'elicitation',
      policySource: 'p1az',
    }), { sessionId: 'sess-1', toolName: 'create_transfer', toolArgs: transferArgs });
    expect(body().prompt).toBe('Confirm create_transfer?');
  });
});

describe('HTTP path — ELICITATION re-call validation', () => {
  it('rejects a re-call with an unknown elicitation_id before consulting the PDP', async () => {
    const authorize = jest.fn(elicitationAuthorize);
    const { body, status } = await runWith(authorize, {
      sessionId: 'sess-1',
      toolArgs: { from_account_id: 'acct-1', amount: 100, _elicitation_confirmed: true, _elicitation_id: 'no-such-id' },
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(status()).toBe(403);
    expect(body().error).toBe('elicitation_required');
    expect(body().reason).toBe('invalid_or_expired');
  });

  it('rejects a valid-looking id issued for a different session', async () => {
    const mint = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs });
    const elicitationId = mint.body().elicitation_id;
    const { body, status } = await runWith(async () => ({ decision: 'PERMIT', policySource: 'p1az' }), {
      sessionId: 'sess-2',
      toolArgs: { from_account_id: "acct-1", amount: 100, _elicitation_confirmed: true, _elicitation_id: elicitationId },
    });
    expect(status()).toBe(403);
    expect(body().error).toBe('elicitation_required');
  });

  it('accepts a valid re-call, forwards the request, and consumes the record (one-time use)', async () => {
    const mint = await runWith(elicitationAuthorize, { sessionId: 'sess-1', toolArgs: withdrawalArgs });
    const elicitationId = mint.body().elicitation_id;

    const confirmAuthorize = jest.fn(async () => ({ decision: 'PERMIT', policySource: 'p1az' }));
    const confirm = await runWith(confirmAuthorize, {
      sessionId: 'sess-1',
      toolArgs: { from_account_id: "acct-1", amount: 100, _elicitation_confirmed: true, _elicitation_id: elicitationId },
    });
    expect(confirm.forwarded).toHaveLength(1);
    // The internal control fields must not leak to the backend.
    const forwardedBody = JSON.parse(confirm.forwarded[0]);
    expect(forwardedBody.params.arguments._elicitation_confirmed).toBeUndefined();
    expect(forwardedBody.params.arguments._elicitation_id).toBeUndefined();
    // The PDP call itself DOES see the confirmation flag (so the policy can permit the retry).
    expect((confirmAuthorize.mock.calls[0] as any[])[3]).toEqual(
      expect.objectContaining({ _elicitation_confirmed: true }),
    );

    // Second use of the same id is rejected — one-time use.
    const replay = await runWith(async () => ({ decision: 'PERMIT', policySource: 'p1az' }), {
      sessionId: 'sess-1',
      toolArgs: { from_account_id: "acct-1", amount: 100, _elicitation_confirmed: true, _elicitation_id: elicitationId },
    });
    expect(replay.status()).toBe(403);
    expect(replay.body().error).toBe('elicitation_required');
  });
});
