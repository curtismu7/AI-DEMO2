const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/admin/index.js');
const { verticalManifest } = require('../../services/verticalManifest');

const EXPECTED_TOOLS = [
  'lookup_customer', 'get_customer_transactions', 'get_customer_profile', 'get_customer_accounts',
  'freeze_account', 'adjust_balance', 'reset_customer_password', 'delete_customer',
];

describe('admin vertical plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('admin', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('declares exactly the eight admin tools', () => {
    expect(plugin.getTools().map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('getHeuristics actions are all declared tools', () => {
    const toolNames = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) expect(toolNames).toContain(h.action);
  });

  it('delete_customer carries the admin:delete tier (gated independently of write)', () => {
    const del = plugin.getTools().find((t) => t.name === 'delete_customer');
    expect(del.scopes).toContain('admin:delete');
    expect(del.scopes).toContain('admin:write');
  });

  it('routes destructive phrases to their tools without colliding', () => {
    const route = (msg) => (plugin.getHeuristics().find((x) => x.re.test(msg)) || {}).action;
    expect(route('delete this customer')).toBe('delete_customer');
    expect(route('freeze this account')).toBe('freeze_account');
    expect(route('adjust account balance')).toBe('adjust_balance');
    expect(route('reset password for this customer')).toBe('reset_customer_password');
    expect(route('look up a customer')).toBe('lookup_customer');
  });

  it('getSystemPrompt returns a non-empty admin directive', () => {
    const p = plugin.getSystemPrompt({ role: 'admin' });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });
});

describe('admin vertical manifest', () => {
  beforeAll(() => verticalManifest.init());

  it('resolves as a schemaVersion-3 admin-kind vertical', () => {
    const m = verticalManifest.resolver.resolve('admin');
    expect(m).toBeTruthy();
    expect(m.id).toBe('admin');
    expect(m.dashboard.kind).toBe('admin');
  });

  it('chips10 are all tool-backed and reference the eight admin tools', () => {
    const chips = verticalManifest.resolver.resolve('admin').dashboard.chips10;
    expect(chips).toHaveLength(8);
    expect(chips.every((c) => typeof c.tool === 'string')).toBe(true);
    expect(chips.map((c) => c.tool).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('is hidden from the user-facing switcher but still resolvable', () => {
    expect(verticalManifest.list().map((v) => v.id)).not.toContain('admin');
    expect(verticalManifest.resolver.resolve('admin')).toBeTruthy();
  });
});
