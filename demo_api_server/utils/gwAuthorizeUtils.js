'use strict';

/**
 * Return the first gw-authorize token event from the given array, or null.
 * Centralises the repeated `events.find(e => e && e.id === 'gw-authorize')`
 * pattern that previously appeared in attackSimulatorService and
 * stepVerificationExpectations.
 * @param {Array} tokenEvents
 * @returns {object|null}
 */
function gwAuthorizeEventFrom(tokenEvents) {
  return (Array.isArray(tokenEvents) ? tokenEvents : []).find(
    (e) => e && e.id === 'gw-authorize',
  ) || null;
}

module.exports = { gwAuthorizeEventFrom };
