'use strict';
/**
 * autonomousAgentScheduler.js — the demo's only way for an agent run to start
 * without a human turn.
 *
 * Follows lighthouseScheduler.js: node-cron, schedule read from configStore at
 * startup, changes take effect on the next BFF restart.
 *
 * Gated on ff_autonomous_agents, default OFF. The flag is checked twice on
 * purpose — once at registration so a disabled demo never even schedules a
 * task, and once inside the tick so flipping the flag off at runtime stops the
 * next run without a restart. An agent that keeps acting after you switched it
 * off is the failure that matters here.
 *
 * Two jobs:
 *   fraud-watch   read only, 02:00 — proves an agent can run unattended
 *   balance-sweep can move money, 06:00 — can exceed its mandate, and that is
 *                 what parks a run for CIBA
 */

const cron = require('node-cron');
const configStore = require('./configStore');
const runStore = require('./lmdb/autonomousRunStore.lmdb');
const cibaSimulated = require('./cibaSimulatedService');
const { runFraudWatch } = require('./fraudWatchJob');
const { runBalanceSweep } = require('./balanceSweepJob');

const JOBS = {
  'fraud-watch': {
    run: runFraudWatch,
    cronKey: 'AUTONOMOUS_FRAUD_WATCH_CRON',
    defaultCron: '0 2 * * *',
    agent: 'Super Banking Fraud Watch Agent',
  },
  'balance-sweep': {
    run: runBalanceSweep,
    cronKey: 'AUTONOMOUS_BALANCE_SWEEP_CRON',
    defaultCron: '0 6 * * *',
    agent: 'Super Banking Balance Sweep Agent',
  },
};

function isEnabled() {
  return configStore.getEffective('ff_autonomous_agents') === 'true';
}

/**
 * Run one job and persist the outcome.
 * @returns {Promise<object|null>} the stored run, or null when disabled
 */
async function runJobNow({ trigger = 'manual', job = 'fraud-watch' } = {}) {
  if (!isEnabled()) {
    console.log('[autonomous-scheduler] ff_autonomous_agents is off — not running');
    return null;
  }
  const def = JOBS[job];
  if (!def) throw new Error(`unknown job: ${job}`);

  let result;
  try {
    result = await def.run();
  } catch (err) {
    // An unexpected throw still gets recorded: a scheduled job that vanishes
    // without a trace is indistinguishable from one that never fired.
    result = { status: 'failed', agent: def.agent, error: err.message, findings: [], tokenEvents: [] };
  }

  const stored = runStore.append({
    job,
    trigger,
    agent: result.agent,
    status: result.status,
    findings: result.findings || [],
    tokenEvents: result.tokenEvents || [],
    scanned: result.scanned || 0,
    ...(result.threshold !== undefined ? { threshold: result.threshold } : {}),
    ...(result.floor !== undefined ? { floor: result.floor } : {}),
    ...(result.mandate ? { mandate: result.mandate } : {}),
    ...(result.proposal ? { proposal: result.proposal } : {}),
    ...(result.pending ? { pending: result.pending } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.error ? { error: result.error } : {}),
  });

  console.log(
    `[autonomous-scheduler] ${job} ${stored.status}` +
    (stored.status === 'parked' ? ` — waiting on ${stored.pending.loginHint}` : '') +
    ` (run ${stored.runId})`
  );
  return stored;
}

/**
 * Has the absent human answered? Simulated CIBA approves on a timer; this is
 * also what an explicit approval short-circuits.
 */
function isParkedRunApproved(run) {
  if (!run || run.status !== 'parked' || !run.pending) return false;
  return cibaSimulated.isSimulatedApproved({ initiatedAt: run.pending.initiatedAt });
}

/** Has the request aged out before anyone answered? */
function isParkedRunExpired(run, now = Date.now()) {
  if (!run || run.status !== 'parked' || !run.pending) return false;
  const ttlMs = (run.pending.expiresIn || 300) * 1000;
  return now - run.pending.initiatedAt > ttlMs;
}

/**
 * Approve a parked run: execute the transfer it was holding, then close it.
 * This is where the money actually moves — parking deliberately did not move
 * it, or the approval would be theatre.
 *
 * @param {string} runId
 * @param {object} deps injectable for tests
 * @returns {Promise<object>} the updated run
 */
async function approveParkedRun(runId, deps = {}) {
  const { createTransaction = (t) => require('../data/store').createTransaction(t) } = deps;

  const run = runStore.get(runId);
  if (!run) throw Object.assign(new Error('run_not_found'), { httpStatus: 404 });
  if (run.status !== 'parked') {
    throw Object.assign(new Error(`run is ${run.status}, not parked`), { httpStatus: 409 });
  }
  if (isParkedRunExpired(run)) {
    return runStore.update(runId, {
      status: 'expired',
      summary: 'the approval request expired before anyone answered',
    });
  }

  const p = run.proposal || {};
  let executed = null;
  try {
    executed = await createTransaction({
      fromAccountId: p.fromAccountId,
      toAccountId: p.toAccountId || null,
      amount: p.amount,
      type: 'transfer',
      description: 'Autonomous balance sweep (approved)',
      status: 'completed',
    });
  } catch (err) {
    return runStore.update(runId, {
      status: 'failed',
      error: `approved but the transfer failed: ${err.message}`,
    });
  }

  return runStore.update(runId, {
    status: 'completed',
    approvedAt: new Date().toISOString(),
    findings: [{ ...p, executed: true, transactionId: executed && executed.id }],
    summary: `approved by ${run.pending.loginHint} — ${p.amount} moved`,
  });
}

/** Deny a parked run: nothing moves, and the run says who declined it. */
function denyParkedRun(runId) {
  const run = runStore.get(runId);
  if (!run) throw Object.assign(new Error('run_not_found'), { httpStatus: 404 });
  if (run.status !== 'parked') {
    throw Object.assign(new Error(`run is ${run.status}, not parked`), { httpStatus: 409 });
  }
  return runStore.update(runId, {
    status: 'denied',
    deniedAt: new Date().toISOString(),
    summary: `declined by ${run.pending.loginHint} — nothing moved`,
  });
}

/**
 * Register the scheduled jobs. No-op (returns null) when the flag is off, so a
 * default demo has no unattended agent at all.
 */
function startScheduler() {
  if (!isEnabled()) {
    console.log('[autonomous-scheduler] ff_autonomous_agents is off — no unattended jobs registered');
    return null;
  }

  const tasks = [];
  for (const [job, def] of Object.entries(JOBS)) {
    const schedule = configStore.getEffective(def.cronKey) || def.defaultCron;
    const valid = cron.validate(schedule) ? schedule : def.defaultCron;
    if (!cron.validate(schedule)) {
      console.warn(`[autonomous-scheduler] Invalid cron "${schedule}" for ${job} — using "${def.defaultCron}"`);
    }
    tasks.push(cron.schedule(valid, () => {
      runJobNow({ trigger: `cron ${valid}`, job }).catch((err) => {
        console.error(`[autonomous-scheduler] ${job} tick failed:`, err.message);
      });
    }));
    console.log(`[autonomous-scheduler] ${job} registered: "${valid}"`);
  }
  return tasks;
}

module.exports = {
  startScheduler,
  runJobNow,
  isEnabled,
  approveParkedRun,
  denyParkedRun,
  isParkedRunApproved,
  isParkedRunExpired,
  JOBS,
};
