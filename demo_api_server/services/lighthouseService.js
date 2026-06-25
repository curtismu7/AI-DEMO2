// demo_api_server/services/lighthouseService.js
'use strict';

const { getDb } = require('./lmdb/openEnv');

const DB_KEY = 'lighthouse_history';
const MAX_HISTORY = 30;
const AUDIT_TIMEOUT_MS = 60_000;

/** In-memory flag — prevents concurrent audit runs. */
let _isRunning = false;

/**
 * Run a Lighthouse audit against the given URL.
 * Requires Chrome to be installed on the host.
 * @returns {Promise<{timestamp, scores, metrics}>}
 */
async function runLighthouseAudit(url) {
  // Lazy-require so the module loads fine in test environments that mock it
  const chromeLauncher = require('chrome-launcher');
  const lighthouse = require('lighthouse').default ?? require('lighthouse');

  let chrome;
  let timedOut = false;
  let timeoutHandle;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (chrome) chrome.kill().catch(() => {});
      const err = new Error('Audit timed out after 60s');
      err.code = 'LIGHTHOUSE_TIMEOUT';
      reject(err);
    }, AUDIT_TIMEOUT_MS);
  });

  const auditPromise = (async () => {
    try {
      chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'] });
    } catch (e) {
      const err = new Error('Chrome could not be launched: ' + e.message);
      err.code = 'CHROME_NOT_FOUND';
      throw err;
    }

    try {
      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        output: 'json',
        logLevel: 'error',
      });

      const cats = runnerResult.lhr.categories;
      const audits = runnerResult.lhr.audits;

      const result = {
        timestamp: new Date().toISOString(),
        scores: {
          performance:   Math.round((cats['performance']?.score   ?? 0) * 100),
          accessibility: Math.round((cats['accessibility']?.score ?? 0) * 100),
          bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
          seo:           Math.round((cats['seo']?.score           ?? 0) * 100),
        },
        metrics: {
          fcp: audits['first-contentful-paint']?.numericValue  ? +(audits['first-contentful-paint'].numericValue / 1000).toFixed(1) : null,
          lcp: audits['largest-contentful-paint']?.numericValue ? +(audits['largest-contentful-paint'].numericValue / 1000).toFixed(1) : null,
          tbt: audits['total-blocking-time']?.numericValue      ? Math.round(audits['total-blocking-time'].numericValue) : null,
          cls: audits['cumulative-layout-shift']?.numericValue  != null ? +audits['cumulative-layout-shift'].numericValue.toFixed(3) : null,
          si:  audits['speed-index']?.numericValue              ? +(audits['speed-index'].numericValue / 1000).toFixed(1) : null,
        },
      };

      if (!timedOut) saveResult(result);
      return result;
    } finally {
      await chrome.kill().catch(() => {});
    }
  })();

  try {
    return await Promise.race([auditPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Persist a result to LMDB, capped at MAX_HISTORY entries.
 * Oldest entry is dropped when the cap is reached.
 */
function saveResult(result) {
  try {
    const db = getDb('lighthouse');
    const existing = db.get(DB_KEY) || [];
    const updated = [...existing, result];
    if (updated.length > MAX_HISTORY) updated.shift();
    db.putSync(DB_KEY, updated);
  } catch (err) {
    console.error('[lighthouse] LMDB write failed — result not persisted:', err.message);
  }
}

/**
 * Return the stored audit history (up to MAX_HISTORY entries), newest last.
 */
function getHistory() {
  try {
    const db = getDb('lighthouse');
    return db.get(DB_KEY) || [];
  } catch (err) {
    console.error('[lighthouse] LMDB read failed:', err.message);
    return [];
  }
}

module.exports = {
  runLighthouseAudit,
  saveResult,
  getHistory,
  get isRunning() { return _isRunning; },
  set isRunning(v) { _isRunning = v; },
};
