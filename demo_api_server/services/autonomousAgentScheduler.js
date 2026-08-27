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

// ── Revocation ──────────────────────────────────────────────────────────────
// An autonomous agent has no session to end, so killing it has to cancel the
// SCHEDULE. Denying its next tool call is not containment: the cron keeps
// firing, each run authenticates, and only the tool call is refused — the agent
// is still acting.
//
// The revoked set is persisted in configStore rather than held in memory,
// because a BFF restart would otherwise re-register the cron and silently
// re-arm an agent somebody had killed. That is the failure worth spending ten
// lines on.
const REVOKED_KEY = 'AUTONOMOUS_AGENTS_REVOKED';

/** Live cron handles, by job id, so they can be stopped without a restart. */
const _tasks = new Map();

function _revokedSet() {
  const raw = configStore.getEffective(REVOKED_KEY) || '';
  return new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
}

/** Is this agent currently revoked? */
function isAgentStopped(agentName) {
  return _revokedSet().has(agentName);
}

async function _persistRevoked(set) {
  await configStore.setRaw({ [REVOKED_KEY]: [...set].join(',') });
}

/**
 * Cancel unattended runs for an agent (or all agents when none is named).
 * Stops the live cron handle AND records the revocation, so a restart does not
 * re-arm it.
 *
 * @param {object} opts - agent: scope-topology apps{} key; omit for all
 * @returns {Promise<{stopped: string[], agents: string[]}>}
 */
async function stopSchedules({ agent } = {}) {
  const revoked = _revokedSet();
  const stopped = [];
  const agents = [];

  for (const [job, def] of Object.entries(JOBS)) {
    if (agent && def.agent !== agent) continue;
    const task = _tasks.get(job);
    if (task) {
      try { task.stop(); } catch (err) {
        console.warn(`[autonomous-scheduler] could not stop ${job}: ${err.message}`);
      }
      _tasks.delete(job);
      stopped.push(job);
    }
    revoked.add(def.agent);
    agents.push(def.agent);
  }

  await _persistRevoked(revoked);

  // One leaver event per agent, so a cancelled schedule reaches the
  // control-plane feed (and the SailPoint forwarder) as a real revocation
  // rather than only a log line. Best-effort: failing to journal must not stop
  // the containment that just happened.
  try {
    const lifecycle = require('./agentLifecycleEvents');
    agents.forEach((agentName) => lifecycle.emit({
      eventType: 'leaver',
      agentId: agentName,
      agentLabel: agentName,
      source: 'this-app',
      kind: 'autonomous',
      reason: 'schedule-cancelled',
      metadata: { stoppedJobs: stopped, revokedVia: 'kill-switch' },
    }));
  } catch (e) {
    console.warn('[autonomous-scheduler] lifecycle emit failed:', e.message);
  }

  console.log(`[autonomous-scheduler] revoked ${agents.join(', ') || '(none)'} — cancelled ${stopped.length} schedule(s)`);
  return { stopped, agents };
}

/**
 * Lift a revocation. Does NOT re-register the cron — that happens on the next
 * startScheduler(), i.e. the next restart. Said plainly here so nobody reads a
 * successful un-revoke as "it is scheduled again".
 */
async function resumeSchedules({ agent } = {}) {
  const revoked = _revokedSet();
  const agents = agent ? [agent] : Object.values(JOBS).map((d) => d.agent);
  agents.forEach((a) => revoked.delete(a));
  await _persistRevoked(revoked);
  return { agents, rescheduledOnRestart: true };
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

  // Belt and braces against the cancel racing a tick already in flight, and
  // against anything that calls runJobNow directly (the manual "Run now"
  // button does). A revoked agent does not run, whatever fired it.
  if (isAgentStopped(def.agent)) {
    console.log(`[autonomous-scheduler] ${job} skipped — ${def.agent} is revoked`);
    return null;
  }

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
    // Which client actually authenticated, and whether that was the agent's own
    // registration. Persisted so a stored run cannot later be read as proof of
    // an identity it never used.
    ...(result.identity ? { identity: result.identity } : {}),
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
    // A revoked agent is not re-armed by a restart. Without this the kill
    // switch would hold only until the next deploy, which is not containment.
    if (isAgentStopped(def.agent)) {
      console.log(`[autonomous-scheduler] ${job} NOT registered — ${def.agent} is revoked`);
      continue;
    }
    const schedule = configStore.getEffective(def.cronKey) || def.defaultCron;
    const valid = cron.validate(schedule) ? schedule : def.defaultCron;
    if (!cron.validate(schedule)) {
      console.warn(`[autonomous-scheduler] Invalid cron "${schedule}" for ${job} — using "${def.defaultCron}"`);
    }
    const task = cron.schedule(valid, () => {
      runJobNow({ trigger: `cron ${valid}`, job }).catch((err) => {
        console.error(`[autonomous-scheduler] ${job} tick failed:`, err.message);
      });
    });
    _tasks.set(job, task);
    tasks.push(task);
    console.log(`[autonomous-scheduler] ${job} registered: "${valid}"`);
  }
  return tasks;
}

module.exports = {
  startScheduler,
  runJobNow,
  isEnabled,
  stopSchedules,
  resumeSchedules,
  isAgentStopped,
  REVOKED_KEY,
  approveParkedRun,
  denyParkedRun,
  isParkedRunApproved,
  isParkedRunExpired,
  JOBS,
};
