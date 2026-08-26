'use strict';
/**
 * agentMandate.js — what an autonomous agent may do unattended without asking.
 *
 * A worker agent needs no mandate: it runs inside a user's session, so the
 * user's own entitlements bound it and the user is right there to consent.
 * An autonomous agent has neither, so the ceiling IS the consent — granted
 * ahead of time, in the declaration.
 *
 * Resolution order, and why:
 *   1. configStore AUTONOMOUS_MANDATE_MAX_AMOUNT — runtime override, so a
 *      ceiling can be dropped mid-demo to force a CIBA pause on the next run
 *      without a redeploy.
 *   2. the agent's `mandate` in scope-topology.json — the declared default,
 *      versioned with the registration.
 *   3. null — no mandate declared. Callers treat that as "may not act
 *      unattended at all" rather than "unlimited": an agent nobody bounded is
 *      the one you least want moving money while nobody watches.
 */

const configStore = require('./configStore');
const scopeTopology = require('./scopeTopology');

const OVERRIDE_KEY = 'AUTONOMOUS_MANDATE_MAX_AMOUNT';

function _positiveNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} agentName scope-topology apps{} key
 * @returns {{ maxAmount: number, window: string, source: 'override'|'topology' }|null}
 */
function getMandate(agentName) {
  const override = _positiveNumber(configStore.getEffective(OVERRIDE_KEY));
  const app = (scopeTopology._manifest().apps || {})[agentName] || null;
  const declared = app && app.mandate ? app.mandate : null;

  if (override !== null) {
    return { maxAmount: override, window: (declared && declared.window) || 'day', source: 'override' };
  }
  if (declared && _positiveNumber(declared.maxAmount) !== null) {
    return { maxAmount: declared.maxAmount, window: declared.window || 'day', source: 'topology' };
  }
  return null;
}

/**
 * Does this amount need a human before the agent may proceed?
 *
 * No mandate → yes, always. That is the safe reading: an undeclared ceiling
 * means nobody has said what this agent may do alone, not that anything goes.
 *
 * @returns {{ withinMandate: boolean, mandate: object|null, amount: number, reason: string }}
 */
function checkAmount(agentName, amount) {
  const mandate = getMandate(agentName);
  const value = Number(amount);

  if (!mandate) {
    return {
      withinMandate: false,
      mandate: null,
      amount: value,
      reason: 'no mandate is declared for this agent, so nothing may be moved unattended',
    };
  }
  if (value > mandate.maxAmount) {
    return {
      withinMandate: false,
      mandate,
      amount: value,
      reason: `${value} is over the ${mandate.maxAmount} the agent may move on its own`,
    };
  }
  return { withinMandate: true, mandate, amount: value, reason: 'within the standing mandate' };
}

module.exports = { getMandate, checkAmount, OVERRIDE_KEY };
