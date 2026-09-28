'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyRuns, runTimingKind, runnerDetails } = require('./dashboard-model');

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
