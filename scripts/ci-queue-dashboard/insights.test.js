'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createControlLog, duplicateRuns, failedJobNames, mainHealth, staleRuns, turnaroundTrend } = require('./insights');
const { parseTopProcesses, processName } = require('./host-load');

function run(id, fields = {}) {
  return {
    id, name: 'CI', workflow_id: 7, event: 'pull_request', status: 'queued', conclusion: null,
    head_branch: 'feature', head_sha: `sha${id}`, display_title: `run ${id}`,
    created_at: '2026-10-01T10:00:00Z', run_started_at: '2026-10-01T10:00:00Z',
    html_url: `https://github.com/o/r/actions/runs/${id}`, ...fields,
  };
}

test('staleRuns flags active PR runs whose pull request merged or closed, and nothing else', () => {
  const runs = [
    run(1, { head_branch: 'merged-branch', status: 'in_progress' }),
    run(2, { head_branch: 'closed-branch' }),
    run(3, { head_branch: 'open-branch' }),
    run(4, { head_branch: 'merged-branch', status: 'completed', conclusion: 'success' }),
    run(5, { head_branch: 'merged-branch', event: 'push' }),
    run(6, { head_branch: 'reopened' }),
  ];
  const open = [{ number: 30, head: { ref: 'open-branch' } }, { number: 31, head: { ref: 'reopened' } }];
  const closed = [
    { number: 20, head: { ref: 'merged-branch' }, merged_at: '2026-10-01T09:00:00Z' },
    { number: 21, head: { ref: 'closed-branch' }, merged_at: null },
    { number: 19, head: { ref: 'reopened' }, merged_at: null },
  ];
  assert.deepEqual(staleRuns(runs, open, closed), [
    { id: 1, pr: 20, state: 'merged' },
    { id: 2, pr: 21, state: 'closed' },
  ]);
});

test('duplicateRuns marks later active runs of the same workflow and commit', () => {
  const runs = [
    run(10, { head_sha: 'abc', created_at: '2026-10-01T10:00:00Z' }),
    run(11, { head_sha: 'abc', created_at: '2026-10-01T10:05:00Z', event: 'workflow_dispatch' }),
    run(12, { head_sha: 'abc', workflow_id: 8 }),
    run(13, { head_sha: 'abc', status: 'completed', conclusion: 'success' }),
    run(14, { head_sha: 'def' }),
  ];
  assert.deepEqual(duplicateRuns(runs), [{ id: 11, duplicateOf: 10 }]);
});

test('mainHealth names the oldest failure since the last green run and ignores cancelled runs', () => {
  const main = (id, conclusion, minute, title) => run(id, {
    head_branch: 'main', event: 'push', status: 'completed', conclusion,
    created_at: `2026-10-01T10:${String(minute).padStart(2, '0')}:00Z`, display_title: title,
  });
  const runs = [
    main(1, 'success', 0, 'Merge pull request #100 from a/green'),
    main(2, 'failure', 10, 'Merge pull request #101 from a/broke-it'),
    main(3, 'cancelled', 20, 'Merge pull request #102 from a/cancelled'),
    main(4, 'failure', 30, 'Fix typo (#103)'),
    run(5, { head_branch: 'feature', status: 'completed', conclusion: 'failure' }),
  ];
  const health = mainHealth(runs);
  assert.equal(health.state, 'red');
  assert.equal(health.latest.id, 4);
  assert.equal(health.firstBad.id, 2);
  assert.equal(health.firstBad.pr, 101);
  assert.equal(mainHealth(runs.slice(0, 1)).state, 'green');
  assert.equal(mainHealth([]).state, 'unknown');
});

test('failedJobNames lists failed and timed-out jobs only', () => {
  assert.deepEqual(failedJobNames([
    { name: 'Gates', conclusion: 'success' },
    { name: 'API', conclusion: 'failure' },
    { name: 'UI', conclusion: 'timed_out' },
    { name: 'Alert', conclusion: 'skipped' },
    { name: 'Main is red (alert)', conclusion: 'failure' },
  ]), ['API', 'UI']);
});

test('turnaroundTrend reports the median trigger-to-result time per day, ignoring runs without a result', () => {
  // run_started_at equals created_at on real runs (it is the trigger time), so it must not be used.
  const done = (id, created, finished, conclusion = 'success') => run(id, { status: 'completed', conclusion, created_at: created, run_started_at: created, updated_at: finished });
  const trend = turnaroundTrend([
    done(1, '2026-09-30T10:00:00Z', '2026-09-30T10:01:00Z'),
    done(2, '2026-09-30T11:00:00Z', '2026-09-30T11:03:00Z'),
    done(3, '2026-09-30T12:00:00Z', '2026-09-30T12:20:00Z'),
    done(4, '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', 'failure'),
    done(5, '2026-10-01T11:00:00Z', '2026-10-01T11:00:00Z', 'cancelled'),
    run(6),
  ]);
  assert.deepEqual(trend, [
    { day: '2026-09-30', medianMs: 180000, runs: 3 },
    { day: '2026-10-01', medianMs: 600000, runs: 1 },
  ]);
});

test('control log attributes a state change to the dashboard only when the dashboard just acted', () => {
  let clock = Date.parse('2026-10-01T11:00:00Z');
  const log = createControlLog({ now: () => new Date(clock) });
  const workflow = (state) => [{ id: 9, name: 'CI', state }];

  assert.deepEqual(log.observe(workflow('active')), [], 'first sight is a baseline, not a change');
  log.noteDashboardAction(9);
  clock += 5000;
  assert.deepEqual(log.observe(workflow('disabled_manually')).map((entry) => [entry.change, entry.source]), [['paused', 'dashboard']]);
  clock += 120000;
  const entries = log.observe(workflow('active'));
  assert.deepEqual(entries.map((entry) => [entry.change, entry.source]), [['resumed', 'outside'], ['paused', 'dashboard']]);
});

test('host load parsing keeps the busiest processes and readable names', () => {
  const output = [
    '134.1 797168 /Library/SystemExtensions/0A44/com.jamf.protect.security-extension',
    '122.2 14390640 /Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper',
    ' 67.3 150384 node (vitest)',
    'not a process row',
  ].join('\n');
  assert.deepEqual(parseTopProcesses(output, 2), [
    { name: 'com.jamf.protect.security-extension', cpuPercent: 134.1, memMb: 778 },
    { name: 'OrbStack', cpuPercent: 122.2, memMb: 14053 },
  ]);
  assert.equal(processName('node (vitest)'), 'node');
});
