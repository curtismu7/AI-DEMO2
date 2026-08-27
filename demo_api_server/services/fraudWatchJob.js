'use strict';
/**
 * fraudWatchJob.js — the demo's first autonomous agent job.
 *
 * Scans the last window of transactions for anything over a configured amount
 * and records what it found. READ ONLY: it moves no money and mutates no
 * record. That is deliberate for Phase 2 — the point of this job is the
 * identity path (an agent authenticating as itself with nobody signed in), not
 * the fraud logic. A threshold is the dumbest rule that still needs the agent
 * to hold a token to do its work.
 *
 * The write-capable job (Balance Sweep) arrives with Phase 3, because it is the
 * one that can exceed a mandate ceiling and so has something for CIBA to pause.
 *
 * Collaborators are injected with real defaults so the job is unit-testable
 * without reaching PingOne or a mocking framework.
 */

const configStore = require('./configStore');
const dataStore = require('../data/store');
const agentCCTokenService = require('./agentCCTokenService');
const { createUnattendedContext } = require('./unattendedRunContext');
const { resolveAgentCredentials } = require('./agentIdentity');

const DEFAULT_THRESHOLD = 1000;
const DEFAULT_WINDOW_HOURS = 24;

/** The agent identity this job authenticates as. */
const AGENT = 'Super Banking Fraud Watch Agent';

function _number(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Run one Fraud Watch pass.
 *
 * @param {object} deps
 *   - now {Date}              clock, injectable so the window is testable
 *   - getToken {function}     mints the agent's own token; default = real CC grant
 *   - readTransactions {function} returns every transaction to consider
 * @returns {Promise<{status, agent, findings, tokenEvents, scanned, threshold, error?}>}
 */
async function runFraudWatch(deps = {}) {
  const {
    now = new Date(),
    // The agent's OWN client when it is provisioned. Without this the run
    // authenticates as the shared token-exchanger and the declared identity is
    // decorative -- see agentIdentity.js.
    getToken = (ctx, creds) => agentCCTokenService.getAgentCCToken(ctx, {
      scope: ['read'],
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    }),
    readTransactions = () => dataStore.getAllTransactions(),
  } = deps;

  const threshold = _number(configStore.getEffective('FRAUD_WATCH_THRESHOLD'), DEFAULT_THRESHOLD);
  const windowHours = _number(configStore.getEffective('FRAUD_WATCH_WINDOW_HOURS'), DEFAULT_WINDOW_HOURS);
  const ctx = createUnattendedContext({ agent: AGENT });
  const creds = resolveAgentCredentials(AGENT);

  // No identity of its own, no run. The agent's registration is declared in
  // scope-topology.json but its credentials are not configured, so there is
  // nothing to authenticate AS. Borrowing the shared token-exchanger client
  // would let the demo keep working while the trace showed an identity the
  // token does not carry -- which is the defect this guard exists to prevent.
  // Refuse before minting anything.
  if (!creds.ownIdentity) {
    return {
      status: 'failed', agent: AGENT,
      identity: { ownIdentity: false, reason: creds.reason },
      error: `agent_not_provisioned: ${creds.reason}`,
      findings: [], tokenEvents: ctx.tokenEvents,
      summary: 'refused — the agent has no identity of its own to act with',
    };
  }

  let token;
  try {
    token = await getToken(ctx, creds);
  } catch (err) {
    // No token, no run. Recording the failure is the point — a scheduled job
    // that silently stops authenticating is exactly the thing an unattended
    // agent must not be able to do quietly.
    return {
      status: 'failed',
      agent: AGENT,
      identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
      error: err.message,
      findings: [],
      tokenEvents: ctx.tokenEvents,
      scanned: 0,
      threshold,
    };
  }

  ctx.recordAgentToken(token, { ownIdentity: true });

  const cutoff = new Date(now.getTime() - windowHours * 3600 * 1000);
  const all = readTransactions() || [];
  const inWindow = all.filter((t) => t && t.createdAt && new Date(t.createdAt) >= cutoff);
  const findings = inWindow
    .filter((t) => Number(t.amount) > threshold)
    .map((t) => ({
      transactionId: t.id,
      amount: Number(t.amount),
      type: t.type || null,
      description: t.description || t.merchant || null,
      createdAt: new Date(t.createdAt).toISOString(),
      reason: `over the ${threshold} threshold`,
    }));

  return {
    status: 'completed',
    agent: AGENT,
    identity: { ownIdentity: creds.ownIdentity, reason: creds.reason },
    findings,
    tokenEvents: ctx.tokenEvents,
    scanned: inWindow.length,
    threshold,
  };
}

module.exports = { runFraudWatch, AGENT, DEFAULT_THRESHOLD, DEFAULT_WINDOW_HOURS };
