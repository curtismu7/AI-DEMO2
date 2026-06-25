'use strict';

const cron = require('node-cron');
const configStore = require('./configStore');
const { runLighthouseAudit } = require('./lighthouseService');

const DEFAULT_CRON = '0 0 * * *'; // midnight daily

/**
 * Start the Lighthouse scheduled audit job.
 * Schedule is read from LIGHTHOUSE_CRON via configStore at startup.
 * Changes to LIGHTHOUSE_CRON take effect on next BFF restart.
 */
function startScheduler() {
  const schedule = configStore.getEffective('LIGHTHOUSE_CRON') || DEFAULT_CRON;
  const validSchedule = cron.validate(schedule) ? schedule : DEFAULT_CRON;

  if (!cron.validate(schedule)) {
    console.warn(`[lighthouse-scheduler] Invalid cron expression "${schedule}" — using default "${DEFAULT_CRON}"`);
  }

  const task = cron.schedule(validSchedule, async () => {
    console.log('[lighthouse-scheduler] Running scheduled audit...');
    try {
      const base = configStore.getEffective('PUBLIC_APP_URL') || 'https://api.ping.demo:4000';
      await runLighthouseAudit(`${base}/admin`);
      console.log('[lighthouse-scheduler] Scheduled audit complete');
    } catch (err) {
      console.error('[lighthouse-scheduler] Scheduled audit failed:', err.message);
    }
  });

  console.log(`[lighthouse-scheduler] Scheduled audit registered: "${validSchedule}"`);
  return task;
}

module.exports = { startScheduler };
