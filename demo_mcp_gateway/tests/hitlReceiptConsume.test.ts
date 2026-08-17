'use strict';

/**
 * HITL receipt single-use on the NODE gateway path.
 *
 * BUGS.md #35 closed receipt replay by making demo_hitl_service's
 * `POST /challenges/:id/verify` consume the challenge on its first successful
 * call. Only PingGateway's Groovy path called it. This gateway called
 * `GET /challenges/:id` and re-ran the binding checks locally, which never
 * mutated challenge state — so the same `_hitl_challenge_id` discharged retry
 * after retry until the 10-minute TTL. That path is the DEFAULT
 * (`ff_mcp_gateway_pinggateway` is off by default), so the replay hole was live.
 *
 * These tests pin the fix: the gateway hits the CONSUMING endpoint, and a
 * second retry against an already-consumed receipt is rejected.
 */

import axios from 'axios';
import { verifyAndConsumeHitlReceipt } from '../src/hitlClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const URL = 'http://hitl.test';
const ID = 'chal-123';
const EXPECTED = {
  userId: 'user-1',
  agentId: 'agent-1',
  tool: 'create_transfer',
  amount: 250,
  params: { amount: 250, toAccountId: 'acct-9' },
};

describe('verifyAndConsumeHitlReceipt', () => {
  beforeEach(() => jest.resetAllMocks());

  it('POSTs to the consuming /verify endpoint — not the read-only GET', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

    await verifyAndConsumeHitlReceipt(URL, ID, EXPECTED);

    // The whole point: a GET leaves the receipt spendable again.
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [calledUrl, body] = mockedAxios.post.mock.calls[0];
    expect(calledUrl).toBe(`${URL}/challenges/${ID}/verify`);
    expect(body).toMatchObject({
      userId: 'user-1',
      agentId: 'agent-1',
      tool: 'create_transfer',
      amount: 250,
      params: { amount: 250, toAccountId: 'acct-9' },
    });
  });

  it('rejects the replay: second retry against a consumed receipt is not ok', async () => {
    // First retry: the service verifies and consumes.
    mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });
    // Second retry with the SAME challenge id: store.consume() moved it to a
    // terminal status, so verifyReceipt now fails the not-approved check.
    mockedAxios.post.mockResolvedValueOnce({
      data: { ok: false, message: 'HITL challenge not approved (status: consumed)' },
    });

    const first = await verifyAndConsumeHitlReceipt(URL, ID, EXPECTED);
    const second = await verifyAndConsumeHitlReceipt(URL, ID, EXPECTED);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/consumed/);
  });

  it('passes a rejection through as ok:false rather than throwing', async () => {
    // A failed binding check is a 200 { ok:false }, so the caller can tell
    // "receipt rejected" (deny) from "service unreachable" (503 fail closed).
    mockedAxios.post.mockResolvedValueOnce({
      data: { ok: false, message: 'HITL challenge belongs to a different user' },
    });

    const result = await verifyAndConsumeHitlReceipt(URL, ID, EXPECTED);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('HITL challenge belongs to a different user');
  });

  it('fails closed when the service returns an unreadable body', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { unexpected: 'shape' } });

    const result = await verifyAndConsumeHitlReceipt(URL, ID, EXPECTED);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unreadable/);
  });

  it('throws on transport failure so call sites keep failing closed with a 503', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(verifyAndConsumeHitlReceipt(URL, ID, EXPECTED)).rejects.toThrow('ECONNREFUSED');
  });
});
