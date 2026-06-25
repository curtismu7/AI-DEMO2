/**
 * @file authorizeSnapshotDrift.test.js
 * CI guard: the committed cloud PingOne Authorize import file must match what the
 * SoT-driven generator produces from scope-topology.json. If a tool's
 * challengeType changes (or a new gated tool is added) without regenerating the
 * snapshot, this fails — preventing the cloud policy from silently drifting out
 * of coverage. Regenerate with: node snapshots/gen-authorize-snapshot.js
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const GEN = path.join(REPO, 'snapshots', 'gen-authorize-snapshot.js');

test('cloud authorize snapshot is in sync with scope-topology.json', () => {
  // --check exits non-zero (throwing here) if the snapshot is out of date.
  expect(() => execFileSync('node', [GEN, '--check'], { cwd: REPO, stdio: 'pipe' })).not.toThrow();
});
