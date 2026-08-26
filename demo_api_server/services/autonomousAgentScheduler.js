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
 */

const cron = require('node-cron');
const configStore = require('./configStore');
const runStore = require('./lmdb/autonomousRunStore.lmdb');
const { runFraudWatch } = require('./fraudWatchJob');

const DEFAULT_CRON = '0 2 * * *'; // 02:00 daily

function isEnabled() {
  return configStore.getEffective('ff_autonomous_agents') === 'true';
}

/**
 * Run one job tick and persist the outcome.
 * Exported so the route and the tests can fire a run without waiting for cron.
 * @returns {Promise<object|null>} the stored run, or null when disabled
 */
async function runJobNow({ trigger = 'manual' } = {}) {
  if (!isEnabled()) {
    console.log('[autonomous-scheduler] ff_autonomous_agents is off — not running');
    return null;
  }

  let result;
  try {
    result = await runFraudWatch();
  } catch (err) {
    // An unexpected throw still gets recorded: a scheduled job that vanishes
    // without a trace is indistinguishable from one that never fired.
    result = {
      status: 'failed',
      agent: 'Super Banking Fraud Watch Agent',
      error: err.message,
      findings: [],
      tokenEvents: [],
    };
  }

  const stored = runStore.append({
    job: 'fraud-watch',
    trigger,
    agent: result.agent,
    status: result.status,
    findings: result.findings || [],
    tokenEvents: result.tokenEvents || [],
    scanned: result.scanned || 0,
    threshold: result.threshold,
    ...(result.error ? { error: result.error } : {}),
  });

  console.log(
    `[autonomous-scheduler] fraud-watch ${stored.status}: ` +
    `${stored.findings.length} finding(s) across ${stored.scanned} transaction(s) (run ${stored.runId})`
  );
  return stored;
}

/**
 * Register the scheduled job. No-op (returns null) when the flag is off, so a
 * default demo has no unattended agent at all.
 */
function startScheduler() {
  if (!isEnabled()) {
    console.log('[autonomous-scheduler] ff_autonomous_agents is off — no unattended jobs registered');
    return null;
  }

  const schedule = configStore.getEffective('AUTONOMOUS_FRAUD_WATCH_CRON') || DEFAULT_CRON;
  const validSchedule = cron.validate(schedule) ? schedule : DEFAULT_CRON;
  if (!cron.validate(schedule)) {
    console.warn(`[autonomous-scheduler] Invalid cron "${schedule}" — using default "${DEFAULT_CRON}"`);
  }

  const task = cron.schedule(validSchedule, () => {
    runJobNow({ trigger: `cron ${validSchedule}` }).catch((err) => {
      console.error('[autonomous-scheduler] tick failed:', err.message);
    });
  });

  console.log(`[autonomous-scheduler] fraud-watch registered: "${validSchedule}"`);
  return task;
}

module.exports = { startScheduler, runJobNow, isEnabled, DEFAULT_CRON };
