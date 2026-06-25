const { createSportingGoodsStore } = require('../../config/verticals/sporting-goods/data');
const { buildSportingGoodsTools } = require('../../config/verticals/sporting-goods/tools');

describe('sporting-goods tools', () => {
  let store;
  let tools;
  let execute;

  beforeEach(() => {
    store = createSportingGoodsStore();
    ({ tools, execute } = buildSportingGoodsTools(store));
  });

  it('declares its own action names (no banking names)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_gear', 'list_rentals', 'gear_order_status', 'loyalty_balance', 'extend_rental'])
    );
    expect(names).not.toContain('create_transfer');
  });

  it('scopes from the generic set', () => {
    for (const t of tools) {
      for (const s of t.scopes) {
        expect(['read', 'write', 'transfer', 'gear:read']).toContain(s);
      }
    }
  });

  it('list_gear returns orders (table render)', async () => {
    const out = await execute('list_gear', {}, { userId: 'u' });
    expect(Array.isArray(out.result.orders)).toBe(true);
    expect(out.render).toBe('list_gear');
  });

  it('list_rentals returns rentals (novel domain, table render)', async () => {
    const out = await execute('list_rentals', {}, { userId: 'u' });
    expect(Array.isArray(out.result.rentals)).toBe(true);
    expect(out.render).toBe('list_rentals');
  });

  it('gear_order_status returns the matching order', async () => {
    const id = store.get('u').orders[0].id;
    const out = await execute('gear_order_status', { orderId: id }, { userId: 'u' });
    expect(out.result.id).toBe(id);
  });

  it('gear_order_status defaults to the most recent order when no orderId is given (one-click chip)', async () => {
    const def = tools.find((t) => t.name === 'gear_order_status');
    expect(def.inputSchema.required).toBeUndefined(); // orderId is optional
    const out = await execute('gear_order_status', {}, { userId: 'u' });
    expect(out.render).toBe('gear_order_status');
    expect(out.result.id).toBe(store.get('u').orders[0].id);
    expect(out.result.error).toBeUndefined();
  });

  it('loyalty_balance returns the loyalty object', async () => {
    const out = await execute('loyalty_balance', {}, { userId: 'u' });
    expect(out.result.points).toBeDefined();
    expect(out.render).toBe('loyalty_balance');
  });

  it('extend_rental (write) extends + consent authz', async () => {
    const rid = store.get('u').rentals[0].id;
    const out = await execute('extend_rental', { rentalId: rid, days: 3 }, { userId: 'u' });
    expect(out.result.status).toBe('Extended');
    const def = tools.find((t) => t.name === 'extend_rental');
    expect(def.authz).toEqual({ consent: true });
  });

  it('unknown tool returns error', async () => {
    const out = await execute('nope', {}, { userId: 'u' });
    expect(out.result.error).toMatch(/unknown tool/i);
  });
});
