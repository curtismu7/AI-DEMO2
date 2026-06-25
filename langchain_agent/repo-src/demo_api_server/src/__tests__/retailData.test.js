const { createRetailStore } = require('../../config/verticals/retail/data');

describe('retail data store', () => {
  let store;
  beforeEach(() => { store = createRetailStore(); });

  it('clones seed per user (independent copies)', () => {
    const a = store.get('user-a');
    store.get('user-b');
    a.orders.push({ id: 'x' });
    expect(store.get('user-b').orders.find((o) => o.id === 'x')).toBeUndefined();
  });

  it('checkout appends an order with status Processing and returns it', () => {
    const order = store.checkout('user-a', { product: 'PS5', amount: 499 });
    expect(order.id).toBeDefined();
    expect(order.status).toBe('Processing');
    expect(order.product).toBe('PS5');
    expect(store.get('user-a').orders.some((o) => o.id === order.id)).toBe(true);
  });
});
