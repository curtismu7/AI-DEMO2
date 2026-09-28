'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyRuns, runTimingKind, runnerDetails, estimateRemainingMs, runDurations, executionDurationMs } = require('./dashboard-model');

test('classifyRuns keeps in-progress work separate from queued work', () => {
  const groups = classifyRuns([
    { id: 1, status: 'in_progress' },
    { id: 2, status: 'queued' },
    { id: 3, status: 'completed', conclusion: 'success' },
    { id: 4, status: 'waiting' },
    { id: 5, status: 'pending' },
    { id: 6, status: 'requested' },
  ]);

  assert.deepEqual(groups.inProgress.map((run) => run.id), [1]);
  assert.deepEqual(groups.queued.map((run) => run.id), [2, 4, 5, 6]);
  assert.deepEqual(groups.completed.map((run) => run.id), [3]);
});

test('runTimingKind treats waiting and queued states as unfinished', () => {
  for (const status of ['queued', 'waiting', 'pending', 'requested']) {
    assert.equal(runTimingKind(status), 'waiting', status);
  }
  assert.equal(runTimingKind('in_progress'), 'running');
  assert.equal(runTimingKind('completed'), 'finished');
});

test('runnerDetails exposes reported group and labels for assigned jobs', () => {
  assert.deepEqual(runnerDetails({
    runnerName: 'cmuir-dev-mac',
    runnerGroup: 'Default',
    labels: ['self-hosted', 'macOS'],
  }), {
    name: 'cmuir-dev-mac',
    state: 'assigned',
    details: ['Group: Default', 'Labels: self-hosted, macOS'],
  });
});

test('runnerDetails retains labels when a queued job has no assigned runner', () => {
  assert.deepEqual(runnerDetails({ status: 'queued', labels: ['linux', 'x64'] }), {
    name: 'Not assigned',
    state: 'unassigned',
    details: ['Labels: linux, x64'],
  });
});

test('estimateRemainingMs uses the median runtime of recent completed runs for the same workflow', () => {
  const current = { workflowId: 7, status: 'in_progress', startedAt: '2026-09-28T11:50:00.000Z' };
  const history = [
    { workflowId: 7, status: 'completed', startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:10:00.000Z' },
    { workflowId: 7, status: 'completed', startedAt: '2026-09-28T10:20:00.000Z', completedAt: '2026-09-28T10:40:00.000Z' },
    { workflowId: 7, status: 'completed', startedAt: '2026-09-28T10:50:00.000Z', completedAt: '2026-09-28T11:20:00.000Z' },
    { workflowId: 9, status: 'completed', startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T12:00:00.000Z' },
  ];

  assert.equal(estimateRemainingMs(current, history, Date.parse('2026-09-28T11:55:00.000Z')), 15 * 60 * 1000);
});

test('estimateRemainingMs returns no estimate when comparable history is missing', () => {
  assert.equal(estimateRemainingMs(
    { workflowId: 7, status: 'in_progress', startedAt: '2026-09-28T11:40:00.000Z' },
    [{ workflowId: 9, status: 'completed', startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:20:00.000Z' }],
    Date.parse('2026-09-28T11:55:00.000Z'),
  ), null);
});

test('estimateRemainingMs reports a negative estimate when runtime exceeds its usual duration', () => {
  assert.equal(estimateRemainingMs(
    { workflowId: 7, status: 'in_progress', startedAt: '2026-09-28T11:40:00.000Z' },
    [{ workflowId: 7, status: 'completed', startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:10:00.000Z' }],
    Date.parse('2026-09-28T11:55:00.000Z'),
  ), -5 * 60 * 1000);
});


const createdAt = '2026-09-28T10:00:00Z';
const startedAt = '2026-09-28T10:02:00Z';
const completedAt = '2026-09-28T10:05:00Z';
const nowMs = Date.parse('2026-09-28T10:06:00Z');

test('runDurations separates ongoing queue wait from execution for queued and running runs', () => {
  assert.deepEqual(runDurations({ status: 'queued', createdAt }, nowMs), { queueWaitMs: 360000, executionMs: null });
  assert.deepEqual(runDurations({ status: 'in_progress', createdAt, startedAt }, nowMs), { queueWaitMs: 120000, executionMs: 240000 });
});

test('runDurations stops both clocks at their explicit completed-run boundaries', () => {
  assert.deepEqual(runDurations({ status: 'completed', createdAt, startedAt, runCompletedAt: completedAt }, nowMs), { queueWaitMs: 120000, executionMs: 180000 });
});

test('runDurations marks missing, invalid and reversed timestamps unavailable without fallback', () => {
  for (const run of [
    { status: 'completed', createdAt, updatedAt: completedAt },
    { status: 'in_progress', createdAt: 'bad', startedAt: null },
    { status: 'completed', createdAt: completedAt, startedAt, runCompletedAt: createdAt },
  ]) assert.deepEqual(runDurations(run, nowMs), { queueWaitMs: null, executionMs: null });
  assert.deepEqual(runDurations({ status: 'completed', createdAt, startedAt }, nowMs), { queueWaitMs: 120000, executionMs: null });
});

test('job and step elapsed time uses now only for in-progress work', () => {
  assert.equal(executionDurationMs({ status: 'in_progress', startedAt }, nowMs), 240000);
  assert.equal(executionDurationMs({ status: 'completed', startedAt, completedAt }, nowMs), 180000);
  assert.equal(executionDurationMs({ status: 'completed', startedAt }, nowMs), null);
  assert.equal(executionDurationMs({ status: 'pending', startedAt }, nowMs), null);
});
