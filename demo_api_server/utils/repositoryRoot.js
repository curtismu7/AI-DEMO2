'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveRepositoryRoot(moduleDirectory, {
  repositoryMount = '/repo',
  existsSync = fs.existsSync,
} = {}) {
  const mountedRoot = path.resolve(repositoryMount);
  return existsSync(path.join(mountedRoot, 'scope-topology.json'))
    ? mountedRoot
    : path.resolve(moduleDirectory, '..', '..');
}

module.exports = { resolveRepositoryRoot };
