const { createSportingGoodsStore } = require('../../config/verticals/sporting-goods/data');

describe('sporting-goods data store', () => {
  let store;
  beforeEach(() => { store = createSportingGoodsStore(); });

  it('clones seed per user (independent copies)', () => {
    const a = store.get('user-a');
    store.get('user-b');
    a.rentals.push({ id: 'x' });
    expect(store.get('user-b').rentals.find((r) => r.id === 'x')).toBeUndefined();
  });

  it('extendRental marks the rental extended and returns it', () => {
    const rid = store.get('user-a').rentals[0].id;
    const out = store.extendRental('user-a', { rentalId: rid, days: 3 });
    expect(out.status).toBe('Extended');
    expect(store.get('user-a').rentals.find((r) => r.id === rid).status).toBe('Extended');
  });

  it('extendRental returns null for an unknown rental', () => {
    expect(store.extendRental('user-a', { rentalId: 'nope', days: 1 })).toBeNull();
  });
});
