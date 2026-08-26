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
 * Three outcomes, not two. "Cannot be evaluated" and "evaluated, and the answer
 * is no" are different things and must not resolve the same way:
 *
 *   WITHIN        a rule matched and allows it — act, nobody needed.
 *   OVER_CEILING  a rule matched and refuses it alone — this is a PAUSE. It is
 *                 the shape the authz server calls PERMIT-with-an-unfulfilled-
 *                 obligation: legitimate request, needs a human. Raise CIBA.
 *   INDETERMINATE nothing to evaluate against — no mandate is declared, so the
 *                 inputs never reach an explicit permit or deny. The PEP must
 *                 FAIL CLOSED. Do NOT raise CIBA: asking a human to approve a
 *                 request the engine could not reason about invites a
 *                 rubber-stamp on something nobody has bounded.
 *
 * Collapsing INDETERMINATE into OVER_CEILING is the bug this shape exists to
 * prevent — it sends an unbounded agent to a human for approval instead of
 * refusing it outright.
 */
const OUTCOME = {
  WITHIN: 'within_mandate',
  OVER_CEILING: 'over_ceiling',
  INDETERMINATE: 'indeterminate',
};

/**
 * @returns {{ outcome: string, mandate: object|null, amount: number, reason: string }}
 */
function checkAmount(agentName, amount) {
  const mandate = getMandate(agentName);
  const value = Number(amount);

  if (!mandate) {
    return {
      outcome: OUTCOME.INDETERMINATE,
      mandate: null,
      amount: value,
      reason: 'no mandate is declared for this agent, so there is nothing to evaluate against — failing closed',
    };
  }
  if (value > mandate.maxAmount) {
    return {
      outcome: OUTCOME.OVER_CEILING,
      mandate,
      amount: value,
      reason: `${value} is over the ${mandate.maxAmount} the agent may move on its own`,
    };
  }
  return {
    outcome: OUTCOME.WITHIN,
    mandate,
    amount: value,
    reason: 'within the standing mandate',
  };
}

module.exports = { getMandate, checkAmount, OUTCOME, OVERRIDE_KEY };
