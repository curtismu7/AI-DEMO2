'use strict';

const path = require('path');
const { createSeedStore } = require('../shared/createSeedStore');

function createAbercrombieFitchStore() {
  const store = createSeedStore(path.join(__dirname, 'seed.json'));
  let sequence = 0;

  store.checkout = (userId, { product, amount }) => {
    sequence += 1;
    const order = {
      id: `ANF-NEW-${sequence}`,
      product,
      amount,
      status: 'Processing',
      date: '2026-08-04',
    };
    store.get(userId).orders.push(order);
    return order;
  };

  return store;
}

module.exports = { createAbercrombieFitchStore };
