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
      // When the caller names a permit/fee, honour that id only. Falling back
      // to "first Outstanding" on a miss paid a different fee and still
      // reported success (e.g. permitId P-DOES-NOT-EXIST → FEE-9001).
      // Chips that omit permitId may still target the first outstanding fee.
      let item;
      if (permitId != null && permitId !== '') {
        const id = String(permitId);
        item = data.fees.items.find(
          (f) => String(f.permitId) === id || String(f.id) === id,
        );
        if (!item) {
          return { error: 'fee not found', permitId: id, status: 'not_found' };
        }
      } else {
        item = data.fees.items.find((f) => f.status === 'Outstanding');
        if (!item) {
          return { error: 'no outstanding fees', status: 'not_found' };
        }
      }
      item.status = 'Paid';
      data.fees.total = Math.max(0, Number((data.fees.total - item.amount).toFixed(2)));
      const paid = amount != null ? Number(amount) : item.amount;
      return { paid, permitId: item.permitId, remainingBalance: data.fees.total, status: 'Paid' };
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
