'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { countContributors } = require('./host-load');

test('countContributors groups the process list by kind and omits empty kinds', () => {
  const ps = [
    '/home/ci/actions-runner-3/_work/_tool/node/22/bin/node vitest.mjs run',
    '/home/ci/actions-runner/externals/node24/bin/node setup/index.js',
    '/opt/homebrew/bin/node /home/ci/repo/node_modules/vitest/dist/workers/forks.js',
    '(claude)',
    '/home/ci/.local/bin/claude --resume',
    '/Applications/Safari.app/Contents/MacOS/Safari',
  ].join('\n');
  assert.deepEqual(countContributors(ps), [
    { label: 'CI runner processes', count: 2 }, { label: 'Test worker processes', count: 2 }, { label: 'Claude processes', count: 2 },
  ]);
});
