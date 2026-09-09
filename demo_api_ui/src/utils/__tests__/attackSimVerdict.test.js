import { describe, expect, it } from 'vitest';
import { attackSimVerdict, attackSimVerdictNote } from '../attackSimVerdict';

describe('attackSimVerdict', () => {
  it('security-tier statuses are DENY', () => {
    expect(attackSimVerdict({ status: 401, errorCode: 'invalid_aud' })).toBe('DENY');
    expect(attackSimVerdict({ status: 403, errorCode: 'insufficient_scope' })).toBe('DENY');
    expect(attackSimVerdict({ status: 429, errorCode: 'rate_limited' })).toBe('DENY');
    expect(attackSimVerdict({ status: 503, errorCode: 'introspection_unavailable' })).toBe('DENY');
  });

  it('2xx is PERMIT', () => {
    expect(attackSimVerdict({ status: 200, reason: 'PERMIT — within granted RAR cap' })).toBe('PERMIT');
  });

  it('a sim that died before its control is ERROR, not DENY', () => {
    expect(attackSimVerdict({ status: 502, errorCode: 'exchange_failed' })).toBe('ERROR');
    expect(attackSimVerdict({ status: 503, errorCode: 'gateway_not_configured' })).toBe('ERROR');
    expect(attackSimVerdict({ status: 502, errorCode: 'gateway_push_failed' })).toBe('ERROR');
    expect(attackSimVerdict({ status: 500, errorCode: 'config_store_failed' })).toBe('ERROR');
    expect(attackSimVerdict({ status: 503, errorCode: 'GATEWAY_UNREACHABLE' })).toBe('ERROR');
    expect(attackSimVerdict({ error: 'sim_execution_failed' })).toBe('ERROR');
    expect(attackSimVerdict({ status: 501, errorCode: 'sim_not_applicable' })).toBe('ERROR');
    expect(attackSimVerdict(undefined)).toBe('ERROR');
  });

  it('notes only the ERROR verdict', () => {
    expect(attackSimVerdictNote('ERROR')).toMatch(/could not run/);
    expect(attackSimVerdictNote('DENY')).toBe('');
  });
});
