'use strict';

/**
 * Session / sign-in card ids. These outlive a single tool call (UI beginTrace
 * carries them forward). Stamping a useCaseId onto them makes every later demo
 * inherit the first scenario's Proof strip identity — skip them here.
 */
const SESSION_EVENT_IDS = new Set([
  'user-token',
  'session-token-introspection',
  'user-token-introspection',
  'id-token',
  'refresh-token',
]);

/**
 * Stamp a useCaseId onto token/activity events that don't already carry one.
 * Pure + in-place; launcher-supplied tags (already present) are never overwritten.
 * Session cards are never stamped (see SESSION_EVENT_IDS).
 * @param {object[]} events
 * @param {string} [useCaseId]
 */
function stampUseCaseId(events, useCaseId) {
  if (!useCaseId || !Array.isArray(events)) return;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object' || ev.useCaseId) continue;
    if (SESSION_EVENT_IDS.has(ev.id)) continue;
    ev.useCaseId = useCaseId;
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
