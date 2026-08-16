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
      // Never fall back to "first open order". A missing/mismatched id must
      // return null — otherwise "release WO-4002" (or a typo) silently releases
      // WO-4001 and reports success. Callers that mean "any/first" (consent
      // chips) must resolve the id themselves before calling.
      if (orderId == null || orderId === '') return null;
      const id = String(orderId);
      const wo = data.workOrders.find((w) => String(w.id) === id)
        || data.workOrders.find((w) => String(w.id) === `WO-${id}`)
        || data.workOrders.find((w) => String(w.id).replace(/^WO-/i, '') === id);
      if (!wo) return null;
      wo.status = 'Released';
      return wo;
    },
  });
}

module.exports = { createManufacturingStore };
