/**
 * Phase B: admin tools are tagged vertical:'admin' so the gateway's tools/list
 * filter (index.ts: keep when !vertical || vertical === allowedVertical) scopes
 * them to the admin vertical — they no longer leak into every vertical's list,
 * and a non-admin session never sees them. Call-time routing is unaffected
 * (guardToolCall keys off the X-Active-Vertical header, not the tool's vertical).
 */
import { BankingToolRegistry } from '../BankingToolRegistry';

const ADMIN_TOOLS = [
  'lookup_customer', 'get_customer_profile', 'get_customer_accounts', 'get_customer_transactions',
  'freeze_account', 'reset_customer_password', 'adjust_balance', 'delete_customer',
];

describe('admin tools carry vertical:\'admin\'', () => {
  const all = BankingToolRegistry.getAllTools();

  it.each(ADMIN_TOOLS)('%s is tagged vertical:admin', (name) => {
    const tool = all.find((t) => t.name === name);
    expect(tool).toBeDefined();
    expect(tool!.vertical).toBe('admin');
  });

  it('admin tools still declare real handlers (execution independent of the vertical tag)', () => {
    for (const name of ADMIN_TOOLS) {
      const tool = all.find((t) => t.name === name)!;
      expect(typeof tool.handler).toBe('string');
      expect(tool.handler.length).toBeGreaterThan(0);
    }
  });

  it('cross-vertical banking tools remain untagged (e.g. get_my_accounts)', () => {
    const acct = all.find((t) => t.name === 'get_my_accounts');
    expect(acct).toBeDefined();
    expect(acct!.vertical).toBeUndefined();
  });
});
