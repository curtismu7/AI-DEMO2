import { extractAccounts, normalizeAccount } from '../apiResponseValidator';

describe('apiResponseValidator — falsy-zero account id', () => {
  it('extractAccounts keeps an account whose id is the number 0', () => {
    const result = extractAccounts({ accounts: [{ id: 0, name: 'Checking' }] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(0);
  });

  it('extractAccounts drops an account with a truly missing id', () => {
    const result = extractAccounts({ accounts: [{ name: 'No id' }] });
    expect(result).toHaveLength(0);
  });

  it('normalizeAccount preserves id 0 instead of fabricating a random id', () => {
    const normalized = normalizeAccount({ id: 0, accountType: 'checking' });
    expect(normalized.id).toBe('0');
  });
});
