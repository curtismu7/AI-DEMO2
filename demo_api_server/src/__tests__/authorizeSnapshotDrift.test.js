/**
 * @file authorizeSnapshotDrift.test.js
 * CI guard: the committed cloud PingOne Authorize import file must match what the
 * SoT-driven generator produces from scope-topology.json. If a tool's
 * challengeType changes (or a new gated tool is added) without regenerating the
 * snapshot, this fails — preventing the cloud policy from silently drifting out
 * of coverage. Regenerate with: node snapshots/gen-authorize-snapshot.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// The generator + snapshot live in a gitignored `snapshots/` directory
// (see .gitignore) that sits next to scope-topology.json. Git worktrees do NOT
// carry gitignored files, so `snapshots/` is absent from worktree checkouts and
// present only in the primary working tree. Resolve the generator by walking up
// from this test until we find a directory that contains
// `snapshots/gen-authorize-snapshot.js`, rather than assuming a fixed depth.
function resolveGenerator() {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'snapshots', 'gen-authorize-snapshot.js');
    if (fs.existsSync(candidate)) {
      return { gen: candidate, repo: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const resolved = resolveGenerator();
const maybeTest = resolved ? test : test.skip;

maybeTest('cloud authorize snapshot is in sync with scope-topology.json', () => {
  // --check exits non-zero (throwing here) if the snapshot is out of date.
  expect(() =>
    execFileSync('node', [resolved.gen, '--check'], { cwd: resolved.repo, stdio: 'pipe' })
  ).not.toThrow();
});
