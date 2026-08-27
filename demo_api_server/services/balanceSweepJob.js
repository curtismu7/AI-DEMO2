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
 *   3. check it against the standing mandate — three outcomes, not two:
 *        within        execute now, nobody needed
 *        over ceiling  a rule matched and refuses it alone → PARK and raise
 *                      CIBA to the account owner. This is a pause.
 *        indeterminate no mandate declared, so nothing to evaluate against →
 *                      DENY and fail closed, raising NO CIBA. "Cannot be
 *                      evaluated" is not "needs approval".
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
const { resolveAgentCredentials } = require('./agentIdentity');
const { authorizeUnattendedTransfer } = require('./autonomousAuthorize');

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
    // The agent's OWN client when it is provisioned -- see agentIdentity.js.
    getToken = (ctx, creds) => agentCCTokenService.getAgentCCToken(ctx, {
      scope: ['read', 'transfer'],
      ...(creds.clientId ? { clientId: creds.clientId, clientSecret: creds.clientSecret } : {}),
    }),
    readAccounts = () => dataStore.getAllAccounts(),
    initiateCiba = (loginHint, bindingMessage) =>
      cibaSimulated.initiateSimulated(loginHint, bindingMessage, 'openid', ''),
    authorize = authorizeUnattendedTransfer,
  } = deps;

  const floor = _positive(configStore.getEffective('BALANCE_SWEEP_FLOOR'), DEFAULT_FLOOR);
  const ctx = createUnattendedContext({ agent: AGENT });
  const creds = resolveAgentCredentials(AGENT);

  let token;
  try {
    token = await getToken(ctx, creds);
  } catch (err) {
    return {
      status: 'failed', agent: AGENT, error: err.message,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      findings: [], tokenEvents: ctx.tokenEvents,
    };
  }
  ctx.recordAgentToken(token, { ownIdentity: creds.ownIdentity });

  const accounts = readAccounts() || [];
  const sweep = _planSweep(accounts, floor);
  if (!sweep) {
    return {
      status: 'completed', agent: AGENT, findings: [], tokenEvents: ctx.tokenEvents,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      scanned: accounts.length, floor,
      summary: `nothing over the ${floor} floor to sweep`,
    };
  }

  // The POLICY decides, not this job. checkAmount() still resolves the declared
  // mandate, but only so it can be SENT — the ceiling is enforced at the PDP.
  const verdict = await authorize({ agentName: AGENT, amount: sweep.amount, type: 'transfer' });

  // The PDP being unreachable is not a permit. An unattended agent that cannot
  // be authorized does not act.
  if (verdict.outcome === 'unavailable') {
    return {
      status: 'failed', agent: AGENT, tokenEvents: ctx.tokenEvents,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      scanned: accounts.length, floor,
      proposal: sweep, findings: [],
      error: `authorization unavailable: ${verdict.error}`,
      summary: 'could not reach the policy engine — nothing moved',
    };
  }

  if (verdict.outcome === 'permit') {
    return {
      status: 'completed', agent: AGENT, tokenEvents: ctx.tokenEvents,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      scanned: accounts.length, floor,
      mandate: verdict.mandate,
      proposal: sweep,
      findings: [{ ...sweep, executed: false, reason: verdict.reason }],
      summary: `${sweep.amount} is within the mandate — swept without asking`,
    };
  }

  // The policy refused. The case that matters here is an agent with no declared
  // mandate: nothing to evaluate against, so the request never reaches an
  // explicit permit, and the PDP fails closed. Deliberately NOT a pause —
  // asking a human to approve a request no policy could reason about just moves
  // an unbounded agent past a rubber stamp. The fix is to declare a mandate,
  // not to find an approver.
  if (verdict.outcome === 'deny') {
    return {
      status: 'denied', agent: AGENT, tokenEvents: ctx.tokenEvents,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      scanned: accounts.length, floor,
      mandate: verdict.mandate,
      proposal: sweep,
      findings: [],
      decision: { decision: verdict.decision, reason: verdict.reason, code: verdict.code },
      summary: verdict.reason || 'denied by policy',
    };
  }

  // outcome === 'pause': the policy PERMITTED, carrying an unfulfilled
  // ciba-approval obligation. That is the authz server's shape for "legitimate
  // request, needs a human" — the PEP discharges it by reaching the absent
  // owner out of band. Park and ask.
  const owner = accounts.find((a) => a.id === sweep.fromAccountId);
  const loginHint = (owner && (owner.userId || owner.ownerId)) || 'demoUser';
  const bindingMessage = `Approve moving ${sweep.amount} from ${sweep.fromName}?`;
  const ciba = initiateCiba(loginHint, bindingMessage);

  return {
    status: 'parked', agent: AGENT, tokenEvents: ctx.tokenEvents,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
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
    decision: { decision: verdict.decision, reason: verdict.reason, code: verdict.code },
    summary: verdict.reason || 'over the standing mandate — waiting on the owner',
  };
}

module.exports = { runBalanceSweep, AGENT, DEFAULT_FLOOR, _planSweep };
