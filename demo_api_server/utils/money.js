'use strict';

/**
 * money.js — single source of truth for currency rounding.
 *
 * All monetary arithmetic in the demo settles to whole cents. Doing the rounding
 * in one place (instead of the `Math.round(x * 100) / 100` expression copied
 * across stores, routes, and services) keeps the invariant consistent and
 * testable: a stored balance or transaction amount can never carry a
 * binary-float artifact (e.g. 0.1 + 0.2 = 0.30000000000000004).
 *
 * This is deliberately a rounding util, NOT an integer-cents money type — the
 * demo stores/display dollars; we only guarantee they are always cent-exact.
 */

/**
 * Round a dollar amount to whole cents (2 decimal places).
 * Coerces with Number() to match the pre-existing call sites. NaN in → NaN out
 * (callers validate amounts before persisting).
 * @param {number|string} n
 * @returns {number}
 */
function roundToCents(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = { roundToCents };
