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

const REPO = path.resolve(__dirname, '../../..');
const GEN = path.join(REPO, 'snapshots', 'gen-authorize-snapshot.js');

// snapshots/ is gitignored (local-only import artifact) — absent on fresh
// clones, CI, and worktrees. Only enforce the drift check where it exists,
// mirroring topology-verify.sh step 3.
const maybeTest = fs.existsSync(GEN) ? test : test.skip;

maybeTest('cloud authorize snapshot is in sync with scope-topology.json', () => {
  // --check exits non-zero (throwing here) if the snapshot is out of date.
  expect(() => execFileSync('node', [GEN, '--check'], { cwd: REPO, stdio: 'pipe' })).not.toThrow();
});
