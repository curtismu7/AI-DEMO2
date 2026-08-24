/**
 * finding #58: the "single audit in progress" guard was released the moment
 * the outer 60s timeout race settled, not when the real Chrome
 * process/lighthouse run actually finished tearing down — a retry right
 * after a timeout could launch a second Chrome instance concurrently with
 * the still-terminating first one. Proves isRunning stays true (and a new
 * call is rejected as LIGHTHOUSE_BUSY) until the real teardown completes.
 */
'use strict';

jest.mock('chrome-launcher', () => ({ launch: jest.fn() }));
jest.mock('lighthouse', () => ({ default: jest.fn() }));
jest.mock('../services/lmdb/openEnv', () => ({
  getDb: jest.fn(() => ({ get: jest.fn(() => []), putSync: jest.fn() })),
}));

const chromeLauncher = require('chrome-launcher');
const lighthouseModule = require('lighthouse');
const lighthouseService = require('../services/lighthouseService');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('lighthouseService — audit-in-progress guard race', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('isRunning stays true (and a retry is rejected) until real Chrome teardown finishes after a timeout', async () => {
    const launchDeferred = deferred();
    const lighthouseDeferred = deferred();
    const killDeferred = deferred();

    chromeLauncher.launch.mockReturnValue(launchDeferred.promise);
    lighthouseModule.default.mockReturnValue(lighthouseDeferred.promise);

    const auditRun = lighthouseService.runLighthouseAudit('https://example.test/admin');
    // Attach a handler immediately so a transient settle-before-await window
    // doesn't trip jest's unhandled-rejection detection; the real assertion
    // on this same promise happens later via `expect(auditRun).rejects`.
    auditRun.catch(() => {});

    // Chrome launches successfully; the lighthouse() call itself hangs (slow audit).
    launchDeferred.resolve({ port: 1234, kill: () => killDeferred.promise });
    await Promise.resolve(); // let the launch .then chain settle
    await Promise.resolve();

    // Fire the 60s timeout.
    await jest.advanceTimersByTimeAsync(60_000);

    await expect(auditRun).rejects.toMatchObject({ code: 'LIGHTHOUSE_TIMEOUT' });

    // The real audit work (lighthouse() + chrome.kill()) has NOT finished yet —
    // the guard must still be held.
    expect(lighthouseService.isRunning).toBe(true);
    await expect(lighthouseService.runLighthouseAudit('https://example.test/admin'))
      .rejects.toMatchObject({ code: 'LIGHTHOUSE_BUSY' });

    // Now let the real background work finish.
    lighthouseDeferred.resolve({
      lhr: { categories: {}, audits: {} },
    });
    killDeferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(lighthouseService.isRunning).toBe(false);
  });
});
