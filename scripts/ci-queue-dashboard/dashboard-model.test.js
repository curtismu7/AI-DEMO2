'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyRuns } = require('./dashboard-model');

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
