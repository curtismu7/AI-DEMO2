'use strict';

/**
 * elicitation.test.ts — elicitation obligation flow.
 *
 * Verifies the gateway correctly dispatches ELICITATION obligations:
 *   1. PingOneAuthorizeClient.evaluate returns obligation:'elicitation' + advice
 *   2. guardToolCall returns obligation:'elicitation' + advice
 *   3. The elicitation obligation is distinct from HITL (reason is still
 *      'HITL_REQUIRED' — branch on obligation, not reason)
 *
 * Session-binding and the -32003 handler live in index.ts handleMessage,
 * which is not exported. The obligation + advice surface is tested here at the
 * PingOneAuthorizeClient / guardToolCall boundary — sufficient to prove the
 * handler in index.ts receives the correct obligation and advice fields.
 */

import axios from 'axios';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';
import { guardToolCall } from '../src/pingAuthorizeGuard';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseConfig: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'https://real.example/authz',
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  p1azEnabled: true,
  allowLocalScopeFallback: false,
};

const decoded: any = {
  sub: 'user-1',
  scope: 'read write',
  act: { sub: 'agent-1' },
  aud: 'mcpgateway.ping.demo',
  exp: 9999999999,
};

// resetAllMocks clears the mockResolvedValueOnce queue between tests, preventing
// unconsumed mocks from one test leaking into the next (clearAllMocks only clears
// call history, not queued return values).
beforeEach(() => jest.resetAllMocks());

// ---------------------------------------------------------------------------
// PingOneAuthorizeClient — elicitation obligation dispatch
// ---------------------------------------------------------------------------

describe('PingOneAuthorizeClient — ELICITATION obligation', () => {
  it('returns obligation:elicitation when PERMIT carries ELICITATION statement (live P1AZ shape)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'PERMIT',
        statements: [{ code: 'ELICITATION', name: 'Elicitation Required' }],
        advice: [{ id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' }],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_withdrawal');
    expect(d.decision).toBe('INDETERMINATE');
    expect(d.obligation).toBe('elicitation');
    // reason stays 'HITL_REQUIRED' — callers MUST branch on obligation, not reason
    expect(d.reason).toBe('HITL_REQUIRED');
  });

  it('surfaces the elicitation-prompt advice value on the returned decision', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'PERMIT',
        statements: [{ code: 'ELICITATION' }],
        advice: [
          { id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' },
          { id: 'other-advice', value: 'ignored' },
        ],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_withdrawal');
    expect(d.advice).toEqual([
      { id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' },
      { id: 'other-advice', value: 'ignored' },
    ]);
  });

  it('returns obligation:elicitation when INDETERMINATE carries ELICITATION statement (mock shape)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        statements: [{ code: 'ELICITATION' }],
        advice: [{ id: 'elicitation-prompt', value: 'Confirm?' }],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_withdrawal');
    expect(d.decision).toBe('INDETERMINATE');
    expect(d.obligation).toBe('elicitation');
    expect(d.advice).toHaveLength(1);
    expect(d.advice![0].id).toBe('elicitation-prompt');
  });

  it('does NOT include advice on non-elicitation obligations (HITL_CONSENT)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'PERMIT',
        statements: [{ code: 'HITL_CONSENT' }],
        advice: [{ id: 'some-advice', value: 'ignored' }],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.obligation).toBe('consent');
    expect(d.advice).toBeUndefined();
  });

  it('advice defaults to empty array when ELICITATION has no advice block', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'PERMIT',
        statements: [{ code: 'ELICITATION' }],
        // no advice field
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_withdrawal');
    expect(d.obligation).toBe('elicitation');
    expect(d.advice).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// guardToolCall — elicitation obligation dispatch (WS path parity)
// ---------------------------------------------------------------------------

describe('guardToolCall — ELICITATION obligation', () => {
  it('returns obligation:elicitation when P1AZ returns PERMIT+ELICITATION', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'PERMIT',
        statements: [{ code: 'ELICITATION' }],
        advice: [{ id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' }],
      },
    });
    const result = await guardToolCall('create_withdrawal', decoded, baseConfig, {});
    expect(result.permitted).toBe(false);
    expect(result.obligation).toBe('elicitation');
    expect(result.reason).toBe('HITL_REQUIRED');
    expect(result.advice).toBeDefined();
    expect(result.advice![0].id).toBe('elicitation-prompt');
  });

  it('returns obligation:elicitation when P1AZ returns INDETERMINATE+ELICITATION', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        statements: [{ code: 'ELICITATION' }],
        advice: [{ id: 'elicitation-prompt', value: 'Confirm?' }],
      },
    });
    const result = await guardToolCall('create_withdrawal', decoded, baseConfig, {});
    expect(result.permitted).toBe(false);
    expect(result.obligation).toBe('elicitation');
    expect(result.advice).toBeDefined();
  });

  it('does NOT return advice when obligation is consent (not elicitation)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        statements: [{ code: 'HITL_CONSENT' }],
        advice: [{ id: 'some-advice', value: 'ignored' }],
      },
    });
    // create_transfer requires 'transfer' scope — supply it so the local scope
    // backstop does not fire before the mocked P1AZ response is consumed.
    const decodedWithTransfer = { ...decoded, scope: 'read write transfer' };
    const result = await guardToolCall('create_transfer', decodedWithTransfer, baseConfig, {});
    expect(result.obligation).toBe('consent');
    expect(result.advice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Obligation discrimination: elicitation vs HITL — reason alone is ambiguous
// ---------------------------------------------------------------------------

describe('elicitation vs HITL — reason is HITL_REQUIRED for both', () => {
  it('elicitation obligation has reason:HITL_REQUIRED (callers must use obligation field)', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          decision: 'PERMIT',
          statements: [{ code: 'ELICITATION' }],
          advice: [],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          decision: 'PERMIT',
          statements: [{ code: 'HITL_CONSENT' }],
        },
      });
    const client = new PingOneAuthorizeClient(baseConfig);
    const elicitation = await client.evaluate(decoded, 'tools/call', 'create_withdrawal');
    const hitl = await client.evaluate(decoded, 'tools/call', 'create_transfer');

    // Both have the same reason — obligation is the discriminator
    expect(elicitation.reason).toBe('HITL_REQUIRED');
    expect(hitl.reason).toBe('HITL_REQUIRED');
    expect(elicitation.obligation).toBe('elicitation');
    expect(hitl.obligation).toBe('consent');
  });
});
