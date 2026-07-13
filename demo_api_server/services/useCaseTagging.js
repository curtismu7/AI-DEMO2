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

/**
 * Stamp a vertical onto token/activity events that don't already carry one.
 * Pure + in-place; launcher-supplied tags (already present) are never overwritten.
 * Same useCaseId slugs are shared across verticals by design, so this is the
 * parallel tag needed to disambiguate which vertical produced an event.
 * @param {object[]} events
 * @param {string} [vertical]
 */
function stampVertical(events, vertical) {
  if (!vertical || !Array.isArray(events)) return;
  for (const ev of events) {
    if (ev && typeof ev === 'object' && !ev.vertical) ev.vertical = vertical;
  }
}

module.exports = { stampUseCaseId, stampVertical };
