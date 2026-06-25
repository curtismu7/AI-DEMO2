/**
 * Regression: filterToolsByScope — privilege isolation.
 *
 * Proves that a read-only token never sees freeze_account (or any
 * admin:write / admin:delete tool) in the MCP tools/list response,
 * and that the correct admin scopes are required to expose it.
 */
import { filterToolsByScope } from '../toolScopeMap';
import { BankingToolRegistry } from '../BankingToolRegistry';

describe('filterToolsByScope — privilege isolation', () => {
  const allTools = BankingToolRegistry.getAllTools();

  it('hides freeze_account from read-only tokens', () => {
    const visible = filterToolsByScope(allTools, ['read']);
    expect(visible.find(t => t.name === 'freeze_account')).toBeUndefined();
  });

  it('exposes freeze_account to tokens with admin:write AND users:manage', () => {
    const visible = filterToolsByScope(allTools, ['admin:write', 'users:manage']);
    expect(visible.find(t => t.name === 'freeze_account')).toBeDefined();
  });

  it('does NOT expose freeze_account to a token with only admin:write (missing users:manage)', () => {
    const visible = filterToolsByScope(allTools, ['admin:write']);
    expect(visible.find(t => t.name === 'freeze_account')).toBeUndefined();
  });

  it('returns only no-scope tools for empty scope list', () => {
    const visible = filterToolsByScope(allTools, []);
    expect(visible.every(t => t.requiredScopes.length === 0)).toBe(true);
  });

  it('hides ALL admin tools from a user with only read scope', () => {
    const visible = filterToolsByScope(allTools, ['read']);
    const adminTools = [
      'freeze_account',
      'reset_customer_password',
      'adjust_balance',
      'delete_customer',
      'lookup_customer',
      'get_customer_profile',
      'get_customer_accounts',
      'get_customer_transactions',
    ];
    adminTools.forEach(name => {
      expect(visible.find(t => t.name === name)).toBeUndefined();
    });
  });

  it('exposes basic read tools (get_my_accounts, get_my_transactions) to read scope', () => {
    const visible = filterToolsByScope(allTools, ['read']);
    expect(visible.find(t => t.name === 'get_my_accounts')).toBeDefined();
    expect(visible.find(t => t.name === 'get_my_transactions')).toBeDefined();
  });

  it('wildcard * exposes all tools including freeze_account', () => {
    const visible = filterToolsByScope(allTools, ['*']);
    expect(visible.find(t => t.name === 'freeze_account')).toBeDefined();
    expect(visible.length).toBe(allTools.length);
  });
});
