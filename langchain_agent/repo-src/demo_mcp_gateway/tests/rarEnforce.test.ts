import { enforceRarSubset, rarDetailsFromEnvelope } from '../src/rarEnforce';

describe('enforceRarSubset (RFC 9396)', () => {
  const grant = [
    { type: 'banking_transaction', tool: 'transfer', actions: ['transfer'], amount: 500, currency: 'USD', payee: 'acct_456' },
  ];

  it('permits an exact-match call', () => {
    const r = enforceRarSubset('transfer', { amount: 500, to_account_id: 'acct_456' }, grant);
    expect(r.ok).toBe(true);
  });

  it('permits an under-amount call to the granted payee', () => {
    const r = enforceRarSubset('transfer', { amount: 100, to_account_id: 'acct_456' }, grant);
    expect(r.ok).toBe(true);
  });

  it('denies an over-amount call', () => {
    const r = enforceRarSubset('transfer', { amount: 5000, to_account_id: 'acct_456' }, grant);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds granted/);
  });

  it('denies a different payee', () => {
    const r = enforceRarSubset('transfer', { amount: 100, to_account_id: 'acct_999' }, grant);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/payee/);
  });

  it('denies a tool not in the grant', () => {
    const r = enforceRarSubset('delete_account', { }, grant);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not in the granted/);
  });

  it('permits (defers to caller) when no grant is present', () => {
    const r = enforceRarSubset('transfer', { amount: 5000 }, undefined);
    expect(r.ok).toBe(true);
  });

  it('extracts authorization_details from a TraT envelope', () => {
    const details = rarDetailsFromEnvelope({ azd: { authorization_details: grant } });
    expect(Array.isArray(details)).toBe(true);
    expect(details && details[0].tool).toBe('transfer');
  });

  it('returns undefined for an envelope without authorization_details', () => {
    expect(rarDetailsFromEnvelope({ azd: { sub: 'u' } })).toBeUndefined();
    expect(rarDetailsFromEnvelope(undefined)).toBeUndefined();
  });
});
