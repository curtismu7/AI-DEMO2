'use strict';

/**
 * Stamp a useCaseId onto token/activity events that don't already carry one.
 * Pure + in-place; launcher-supplied tags (already present) are never overwritten.
 * @param {object[]} events
 * @param {string} [useCaseId]
 */
function stampUseCaseId(events, useCaseId) {
  if (!useCaseId || !Array.isArray(events)) return;
  for (const ev of events) {
    if (ev && typeof ev === 'object' && !ev.useCaseId) ev.useCaseId = useCaseId;
  }
}

module.exports = { stampUseCaseId };
