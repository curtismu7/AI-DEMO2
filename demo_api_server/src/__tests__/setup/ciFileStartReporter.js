'use strict';

/**
 * ciFileStartReporter.js — emits one line to stdout as each test FILE starts.
 *
 * Why: in CI (non-TTY) jest's default reporter only prints PASS/FAIL when a file
 * COMPLETES. If a file hangs (e.g. a synchronous block or an unbounded network
 * wait that the per-test timeout cannot interrupt), the log goes silent and the
 * job is killed by the workflow timeout with no indication of WHICH file hung.
 * This reporter prints the path on start, so the last "TEST-FILE-START" line
 * with no matching PASS/FAIL is the culprit — turning a 20-minute mystery into a
 * one-line read. Output-only; it never changes test behaviour.
 */
class CiFileStartReporter {
  onTestStart(test) {
    // CI-only: keep local dev output clean.
    if (process.env.CI === 'true') {
      process.stdout.write(`TEST-FILE-START ${test.path}\n`);
    }
  }
}

module.exports = CiFileStartReporter;
