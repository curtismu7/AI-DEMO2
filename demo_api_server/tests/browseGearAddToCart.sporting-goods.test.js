// demo_api_server/tests/browseGearAddToCart.sporting-goods.test.js
'use strict';

const { createSportingGoodsStore } = require('../config/verticals/sporting-goods/data');
const { buildSportingGoodsTools } = require('../config/verticals/sporting-goods/tools');

describe('sporting-goods browse_gear / add_to_cart', () => {
  it('browse_gear returns the seeded product list', () => {
    const store = createSportingGoodsStore();
    const data = store.get('user-1');
    expect(data.products.length).toBe(6);
    expect(data.products[0]).toHaveProperty('price');
  });

  it('add_to_cart pushes an entry into the per-user cart', () => {
    const store = createSportingGoodsStore();
    const entry = store.addToCart('user-1', { productId: 'prod-boots' });
    expect(entry).not.toBeNull();
    expect(entry.productId).toBe('prod-boots');
    expect(store.get('user-1').cart).toHaveLength(1);
  });

  it('add_to_cart returns null for an unknown productId', () => {
    const store = createSportingGoodsStore();
    const entry = store.addToCart('user-1', { productId: 'does-not-exist' });
    expect(entry).toBeNull();
  });
});

// Important fix: the tests above only exercised the store layer (store.get() /
// store.addToCart()) directly — never tools.js's execute() switch, so the
// render:'browse_gear' / render:'add_to_cart' keys and the { products: [...] }
// result shape VerticalResult.jsx actually consumes were never verified.
describe('sporting-goods tools.js execute() — browse_gear / add_to_cart', () => {
  it('execute("browse_gear") returns { result: { products }, render: "browse_gear" }', async () => {
    const store = createSportingGoodsStore();
    const { execute } = buildSportingGoodsTools(store);
    const out = await execute('browse_gear', {}, { userId: 'user-1' });
    expect(out.render).toBe('browse_gear');
    expect(Array.isArray(out.result.products)).toBe(true);
    expect(out.result.products.length).toBe(6);
    expect(out.result.products[0]).toHaveProperty('name');
    expect(out.result.products[0]).toHaveProperty('price');
  });

  it('execute("add_to_cart") returns { result: entry, render: "add_to_cart" } with the fields VerticalResult\'s card descriptor reads', async () => {
    const store = createSportingGoodsStore();
    const { execute } = buildSportingGoodsTools(store);
    const out = await execute('add_to_cart', { productId: 'prod-boots' }, { userId: 'user-1' });
    expect(out.render).toBe('add_to_cart');
    // sporting-goods/manifest.json's render.add_to_cart card reads fields
    // "name" and "price" off the result — both must be present and correctly typed.
    expect(out.result).toHaveProperty('productId', 'prod-boots');
    expect(typeof out.result.name).toBe('string');
    expect(typeof out.result.price).toBe('number');
  });

  it('execute("add_to_cart") with an unknown productId returns a text-render error, not a crash', async () => {
    const store = createSportingGoodsStore();
    const { execute } = buildSportingGoodsTools(store);
    const out = await execute('add_to_cart', { productId: 'does-not-exist' }, { userId: 'user-1' });
    expect(out.render).toBe('text');
    expect(out.result.error).toBe('product not found');
  });
});
