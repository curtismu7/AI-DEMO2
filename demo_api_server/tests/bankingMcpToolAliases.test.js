'use strict';

const { resolveBankingMcpToolAlias } = require('../services/bankingMcpToolAliases');

describe('resolveBankingMcpToolAlias', () => {
  test.each(['get_balance', 'banking.get_balance'])(
    '%s without an account id reads the signed-in user account overview',
    (tool) => {
      expect(resolveBankingMcpToolAlias(tool, {}, 'banking')).toEqual({
        tool: 'get_my_accounts',
        intent: 'view_balance',
      });
    },
  );

  test('get_balance with an account id reads that specific account', () => {
    expect(resolveBankingMcpToolAlias('get_balance', { account_id: 'acct-1' }, 'banking')).toEqual({
      tool: 'get_account_balance',
      intent: 'view_balance',
    });
  });

  test.each([
    ['get_accounts', { account_type: 'checking' }, 'get_my_accounts', 'view_accounts'],
    ['banking.get_accounts', {}, 'get_my_accounts', 'view_accounts'],
    ['get_transactions', { limit: 5 }, 'get_my_transactions', 'view_transactions'],
    ['banking.get_transactions', { offset: 10 }, 'get_my_transactions', 'view_transactions'],
  ])('%s resolves to the registered banking tool', (alias, params, tool, intent) => {
    expect(resolveBankingMcpToolAlias(alias, params, 'banking')).toEqual({ tool, intent });
  });

  test('does not rewrite a balance alias from another vertical', () => {
    expect(resolveBankingMcpToolAlias('get_balance', {}, 'airlines')).toBeNull();
  });

  test('leaves registered tool names and unrelated names untouched', () => {
    expect(resolveBankingMcpToolAlias('get_my_accounts', {}, 'banking')).toBeNull();
    expect(resolveBankingMcpToolAlias('banking.some_other_tool', {}, 'banking')).toBeNull();
  });
});
