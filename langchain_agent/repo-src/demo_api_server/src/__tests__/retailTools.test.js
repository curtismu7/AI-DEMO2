const { createRetailStore } = require('../../config/verticals/retail/data');
const { buildRetailTools } = require('../../config/verticals/retail/tools');

describe('retail tools', () => {
  let store;
  let tools;
  let execute;

  beforeEach(() => {
    store = createRetailStore();
    ({ tools, execute } = buildRetailTools(store));
  });

  it('declares its own action names (no banking names)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_orders', 'order_status', 'rewards_balance', 'checkout']));
    expect(names).not.toContain('create_transfer');
    expect(names).not.toContain('get_my_accounts');
  });

  it('every tool declares scopes from the generic set', () => {
    for (const t of tools) {
      for (const s of t.scopes) {
        expect(['read', 'write', 'transfer', 'largepurchase:read']).toContain(s);
      }
    }
  });

  it('list_orders returns the orders with a table render', async () => {
    const out = await execute('list_orders', {}, { userId: 'u' });
    expect(Array.isArray(out.result.orders)).toBe(true);
    expect(out.render).toBe('list_orders');
  });

  it('order_status returns the matching order', async () => {
    const id = store.get('u').orders[0].id;
    const out = await execute('order_status', { orderId: id }, { userId: 'u' });
    expect(out.result.id).toBe(id);
    expect(out.render).toBe('order_status');
  });

  it('order_status returns error for unknown id', async () => {
    const out = await execute('order_status', { orderId: 'nope' }, { userId: 'u' });
    expect(out.result.error).toBeDefined();
  });

  it('order_status defaults to the most recent order when no orderId is given (one-click chip)', async () => {
    const def = tools.find((t) => t.name === 'order_status');
    expect(def.inputSchema.required).toBeUndefined(); // orderId is optional
    const out = await execute('order_status', {}, { userId: 'u' });
    expect(out.render).toBe('order_status');
    expect(out.result.id).toBe(store.get('u').orders[0].id);
    expect(out.result.error).toBeUndefined();
  });

  it('rewards_balance returns the rewards object', async () => {
    const out = await execute('rewards_balance', {}, { userId: 'u' });
    expect(out.result.points).toBeDefined();
    expect(out.render).toBe('rewards_balance');
  });

  it('checkout (write) writes an order and is gated by consent authz', async () => {
    const out = await execute('checkout', { product: 'PS5', amount: 499 }, { userId: 'u' });
    expect(out.result.status).toBe('Processing');
    expect(out.render).toBe('checkout');
    const def = tools.find((t) => t.name === 'checkout');
    expect(def.authz).toEqual({ consent: true });
  });

  it('unknown tool returns an error result (no throw)', async () => {
    const out = await execute('not_a_tool', {}, { userId: 'u' });
    expect(out.result.error).toMatch(/unknown tool/i);
  });
});
