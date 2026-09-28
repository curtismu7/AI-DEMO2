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

  test('does not rewrite a balance alias from another vertical', () => {
    expect(resolveBankingMcpToolAlias('get_balance', {}, 'airlines')).toBeNull();
  });

  test('leaves registered tool names and unrelated names untouched', () => {
    expect(resolveBankingMcpToolAlias('get_my_accounts', {}, 'banking')).toBeNull();
    expect(resolveBankingMcpToolAlias('banking.some_other_tool', {}, 'banking')).toBeNull();
  });
});
