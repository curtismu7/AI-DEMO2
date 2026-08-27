/**
 * A client error is not upstream sickness.
 *
 * The breaker used to call onFailure() on EVERY thrown error, so a 403
 * "Access denied. You can only check your own account balance" — an authorization
 * control working exactly as designed — counted the same as the banking API being
 * unreachable. With failureThreshold 5, five cross-owner reads took banking tools
 * down for every user for a minute (TECH_DEBT 2026-08-26).
 *
 * That is reachable ON PURPOSE: UC10 is the demo's cross-owner attack simulation,
 * whose entire point is to present another owner's account id and be denied.
 *
 * Reproduced live 2026-08-26: four wrong account_ids -> 403s -> the next call
 * returned "Banking API is currently unavailable (circuit breaker open)" while
 * /health was 200 and the container had been up nine hours.
 */

import { CircuitBreaker, CircuitBreakerState, CircuitBreakerError } from '../CircuitBreaker';
import { BankingAPIClient } from '../../banking/BankingAPIClient';

const CONFIG = { failureThreshold: 5, resetTimeout: 60000, monitoringPeriod: 10000 };

/** The shape BankingAPIClient's mapError produces. */
const httpError = (statusCode: number, message = 'boom') =>
  Object.assign(new Error(message), { statusCode });

/** A raw axios error, before mapError wraps it. */
const axiosError = (status: number) =>
  Object.assign(new Error('request failed'), { response: { status } });

const bankingBreaker = () =>
  new CircuitBreaker({ ...CONFIG, isFailure: (e) => !BankingAPIClient.isClientError(e) });

const fire = async (cb: CircuitBreaker, err: unknown, times: number) => {
  for (let i = 0; i < times; i++) {
    await cb.execute(async () => { throw err; }).catch(() => {});
  }
};

describe('CircuitBreaker — client errors must not trip it', () => {
  it('stays CLOSED through 10 consecutive 403s', async () => {
    const cb = bankingBreaker();
    await fire(cb, httpError(403, 'Access denied. You can only check your own account balance.'), 10);
    expect(cb.getStats().state).toBe(CircuitBreakerState.CLOSED);
  });

  it('still serves requests after those 403s — the regression', async () => {
    const cb = bankingBreaker();
    await fire(cb, httpError(403), 10);
    // Before the fix this threw CircuitBreakerError instead of running fn().
    await expect(cb.execute(async () => 'balance: 5000')).resolves.toBe('balance: 5000');
  });

  it('stays CLOSED for a raw axios 403, before mapError wraps it', async () => {
    const cb = bankingBreaker();
    await fire(cb, axiosError(403), 10);
    expect(cb.getStats().state).toBe(CircuitBreakerState.CLOSED);
  });

  it.each([400, 401, 403, 404, 422])('stays CLOSED for repeated %i', async (status) => {
    const cb = bankingBreaker();
    await fire(cb, httpError(status), 10);
    expect(cb.getStats().state).toBe(CircuitBreakerState.CLOSED);
  });

  // The breaker must still do its actual job.
  it('OPENS on real upstream failures', async () => {
    const cb = bankingBreaker();
    await fire(cb, Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }), 5);
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
    await expect(cb.execute(async () => 'never')).rejects.toBeInstanceOf(CircuitBreakerError);
  });

  it('OPENS on 5xx — the server really is failing', async () => {
    const cb = bankingBreaker();
    await fire(cb, httpError(503), 5);
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
  });

  // 429 is the deliberate exception: rate limiting IS upstream distress, and the
  // retry manager already treats it as retryable.
  it('OPENS on 429, unlike other 4xx', async () => {
    const cb = bankingBreaker();
    await fire(cb, httpError(429), 5);
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
  });

  it('a mix of 403s and real failures opens only on the real ones', async () => {
    const cb = bankingBreaker();
    await fire(cb, httpError(403), 20);
    expect(cb.getStats().state).toBe(CircuitBreakerState.CLOSED);
    await fire(cb, httpError(500), 5);
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
  });
});

describe('CircuitBreaker — default behaviour is unchanged', () => {
  it('counts every error when no isFailure predicate is supplied', async () => {
    const cb = new CircuitBreaker(CONFIG);
    await fire(cb, httpError(403), 5);
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
  });

  it('fails safe when the predicate itself throws', async () => {
    const cb = new CircuitBreaker({
      ...CONFIG,
      isFailure: () => { throw new Error('predicate blew up'); },
    });
    await fire(cb, httpError(500), 5);
    // A broken predicate must never mask a real outage.
    expect(cb.getStats().state).toBe(CircuitBreakerState.OPEN);
  });
});

describe('BankingAPIClient.isClientError', () => {
  it.each([400, 401, 403, 404, 422, 499])('%i is a client error', (s) => {
    expect(BankingAPIClient.isClientError(httpError(s))).toBe(true);
  });

  it.each([429, 500, 502, 503])('%i is NOT a client error', (s) => {
    expect(BankingAPIClient.isClientError(httpError(s))).toBe(false);
  });

  it('reads a raw axios response status too', () => {
    expect(BankingAPIClient.isClientError(axiosError(403))).toBe(true);
    expect(BankingAPIClient.isClientError(axiosError(503))).toBe(false);
  });

  it('treats a status-less error as not-a-client-error (so it still trips)', () => {
    expect(BankingAPIClient.isClientError(new Error('socket hang up'))).toBe(false);
    expect(BankingAPIClient.isClientError(null)).toBe(false);
    expect(BankingAPIClient.isClientError(undefined)).toBe(false);
  });
});
