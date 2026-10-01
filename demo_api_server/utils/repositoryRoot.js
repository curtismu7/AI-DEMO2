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

/**
 * The commit the checkout at `root` is on, or null. Read from the files rather
 * than a `git` binary, which the BFF image does not carry. A build may declare
 * it instead through GIT_COMMIT / COMMIT_SHA.
 */
// ponytail: handles a normal checkout only — in a linked worktree `.git` is a
// file and this returns null. Follow its `gitdir:` if a worktree ever serves.
function readRepositoryRevision(root, { env = process.env, readFileSync = fs.readFileSync } = {}) {
  if (env.GIT_COMMIT || env.COMMIT_SHA) return env.GIT_COMMIT || env.COMMIT_SHA;
  const read = (...parts) => {
    try { return readFileSync(path.join(root, '.git', ...parts), 'utf8').trim(); } catch { return ''; }
  };
  const head = read('HEAD');
  if (!head.startsWith('ref: ')) return /^[0-9a-f]{40}$/.test(head) ? head : null;
  const ref = head.slice('ref: '.length);
  const packed = read('packed-refs').split('\n').find((line) => line.endsWith(' ' + ref));
  return read(ref) || (packed ? packed.split(' ')[0] : null);
}

module.exports = { resolveRepositoryRoot, readRepositoryRevision };
