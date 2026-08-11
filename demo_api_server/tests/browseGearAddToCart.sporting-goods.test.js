// demo_api_server/tests/browseGearAddToCart.sporting-goods.test.js
'use strict';

const { createSportingGoodsStore } = require('../config/verticals/sporting-goods/data');

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
