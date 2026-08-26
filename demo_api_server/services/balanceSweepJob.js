'use strict';
/**
 * balanceSweepJob.js — the autonomous agent that can actually move money.
 *
 * Phase 3's job. Fraud Watch (Phase 2) proved an agent can run with nobody
 * signed in, but it only reads, so it can never exceed a ceiling and never has
 * anything to ask about. This one proposes a transfer, and that is what gives
 * CIBA something real to pause.
 *
 * Shape of a run:
 *   1. authenticate as the agent itself (client_credentials — sub = agent, no
 *      act claim, because nobody delegated it)
 *   2. work out a sweep: surplus over the floor, from checking to savings
 *   3. check it against the standing mandate
 *        within  → execute now, nobody needed
 *        over    → PARK the run and raise CIBA to the account owner
 *
 * The transfer is NOT executed at park time. It executes on approval, in
 * approveParkedRun(). A parked run that had already moved the money would make
 * the approval theatre.
 */

const configStore = require('./configStore');
const dataStore = require('../data/store');
const agentCCTokenService = require('./agentCCTokenService');
const cibaSimulated = require('./cibaSimulatedService');
const { createUnattendedContext } = require('./unattendedRunContext');
const { checkAmount } = require('./agentMandate');

/** The agent identity this job authenticates as. */
const AGENT = 'Super Banking Balance Sweep Agent';

/** Leave this much in checking; anything above it is sweepable. */
const DEFAULT_FLOOR = 2000;

function _positive(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function _round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Pick the sweep: the largest surplus over the floor across checking accounts.
 * Returns null when nothing is sweepable.
 */
function _planSweep(accounts, floor) {
  let best = null;
  for (const acct of accounts || []) {
    const type = String(acct.type || acct.accountType || '').toLowerCase();
    if (!type.includes('checking')) continue;
    const balance = Number(acct.balance);
    if (!Number.isFinite(balance)) continue;
    const surplus = _round2(balance - floor);
    if (surplus <= 0) continue;
    if (!best || surplus > best.amount) {
      best = { fromAccountId: acct.id, fromName: acct.name || acct.type || acct.id, amount: surplus, balance };
    }
  }
  return best;
}

/**
 * Run one Balance Sweep pass.
 *
 * @param {object} deps injectable for tests; real services by default
 * @returns {Promise<object>} a run record: completed | parked | failed
 */
async function runBalanceSweep(deps = {}) {
  const {
    getToken = (ctx) => agentCCTokenService.getAgentCCToken(ctx, { scope: ['read', 'transfer'] }),
    readAccounts = () => dataStore.getAllAccounts(),
    initiateCiba = (loginHint, bindingMessage) =>
      cibaSimulated.initiateSimulated(loginHint, bindingMessage, 'openid', ''),
  } = deps;

  const floor = _positive(configStore.getEffective('BALANCE_SWEEP_FLOOR'), DEFAULT_FLOOR);
  const ctx = createUnattendedContext({ agent: AGENT });

  let token;
  try {
    token = await getToken(ctx);
  } catch (err) {
    return {
      status: 'failed', agent: AGENT, error: err.message,
      findings: [], tokenEvents: ctx.tokenEvents,
    };
  }
  ctx.recordAgentToken(token);

  const accounts = readAccounts() || [];
  const sweep = _planSweep(accounts, floor);
  if (!sweep) {
    return {
      status: 'completed', agent: AGENT, findings: [], tokenEvents: ctx.tokenEvents,
      scanned: accounts.length, floor,
      summary: `nothing over the ${floor} floor to sweep`,
    };
  }

  const verdict = checkAmount(AGENT, sweep.amount);

  if (verdict.withinMandate) {
    return {
      status: 'completed', agent: AGENT, tokenEvents: ctx.tokenEvents,
      scanned: accounts.length, floor,
      mandate: verdict.mandate,
      proposal: sweep,
      findings: [{ ...sweep, executed: false, reason: verdict.reason }],
      summary: `${sweep.amount} is within the mandate — swept without asking`,
    };
  }

  // Over the ceiling: park and ask the owner. The account owner is the human
  // this agent acts for even though they are not here.
  const owner = accounts.find((a) => a.id === sweep.fromAccountId);
  const loginHint = (owner && (owner.userId || owner.ownerId)) || 'demoUser';
  const bindingMessage = `Approve moving ${sweep.amount} from ${sweep.fromName}?`;
  const ciba = initiateCiba(loginHint, bindingMessage);

  return {
    status: 'parked', agent: AGENT, tokenEvents: ctx.tokenEvents,
    scanned: accounts.length, floor,
    mandate: verdict.mandate,
    proposal: sweep,
    findings: [],
    pending: {
      authReqId: ciba.auth_req_id,
      initiatedAt: Date.now(),
      expiresIn: ciba.expires_in,
      loginHint,
      bindingMessage,
      engine: 'simulated',
    },
    summary: verdict.reason,
  };
}

module.exports = { runBalanceSweep, AGENT, DEFAULT_FLOOR, _planSweep };
