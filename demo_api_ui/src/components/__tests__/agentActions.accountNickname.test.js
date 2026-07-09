import { ACTION_GROUPS, API_DIRECT_CHIPS } from '../agentActions';

describe('agentActions — account nickname chip', () => {
  it('registers Account nickname in the account action group', () => {
    const chip = ACTION_GROUPS.account.find((a) => a.id === 'account_nickname');
    expect(chip).toBeDefined();
    expect(chip.label).toBe('Account nickname');
  });

  it('includes account_nickname in API_DIRECT_CHIPS', () => {
    expect(API_DIRECT_CHIPS.has('account_nickname')).toBe(true);
  });
});
