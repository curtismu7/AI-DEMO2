'use strict';

const path = require('path');
const { createSeedStore } = require('../shared/createSeedStore');

/**
 * Per-vertical Precision Works data store. Genuine manufacturing objects (work
 * orders, inventory, production history) keyed by userId — NOT relabeled banking
 * accounts. Per-user cloning + seed load come from the shared createSeedStore
 * helper; mutators receive the calling user's cloned data.
 */
function createManufacturingStore() {
  let seq = 0;
  return createSeedStore(path.join(__dirname, 'seed.json'), {
    scheduleRun(data, { workOrder, when } = {}) {
      seq += 1;
      const wo = workOrder || (data.workOrders[0] && data.workOrders[0].id) || 'WO-0000';
      const entry = { id: `PR-new-${seq}`, type: 'Run', workOrder: wo, date: when || '2026-06-20', status: 'Scheduled' };
      data.productionHistory.push(entry);
      return { workOrder: wo, when: entry.date, status: 'Scheduled' };
    },
    releaseWorkOrder(data, orderId) {
      const wo = data.workOrders.find((w) => w.id === orderId)
        || data.workOrders.find((w) => w.status !== 'Released');
      if (!wo) return null;
      wo.status = 'Released';
      return wo;
    },
  });
}

module.exports = { createManufacturingStore };
