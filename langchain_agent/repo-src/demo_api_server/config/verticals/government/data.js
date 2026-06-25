'use strict';

const path = require('path');
const { createSeedStore } = require('../shared/createSeedStore');

/**
 * Per-vertical CivicPermit data store. Genuine permitting objects (permits,
 * fees, filings) keyed by userId — NOT relabeled banking accounts. Per-user
 * cloning + seed load come from the shared createSeedStore helper; mutators
 * receive the calling user's cloned data.
 */
function createGovernmentStore() {
  return createSeedStore(path.join(__dirname, 'seed.json'), {
    payFee(data, { amount, permitId } = {}) {
      const item = data.fees.items.find((f) => f.permitId === permitId || f.id === permitId)
        || data.fees.items.find((f) => f.status === 'Outstanding');
      if (item) {
        item.status = 'Paid';
        data.fees.total = Math.max(0, Number((data.fees.total - item.amount).toFixed(2)));
      }
      const paid = amount != null ? Number(amount) : item ? item.amount : 0;
      return { paid, permitId: item ? item.permitId : permitId, remainingBalance: data.fees.total, status: 'Paid' };
    },
    releaseRecord(data, permitId) {
      const permit = data.permits.find((p) => p.id === permitId);
      if (!permit) return null;
      permit.status = 'Released';
      return permit;
    },
  });
}

module.exports = { createGovernmentStore };
