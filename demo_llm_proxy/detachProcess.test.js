const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const launcher = path.join(__dirname, 'start-detached.sh');

test('detached process survives after its supervisor shell exits', async (t) => {
  const result = spawnSync(
    'bash',
    ['-c', 'bash "$1" /bin/sleep 30 >/dev/null 2>&1 & echo $!', 'test-supervisor', launcher],
    { detached: true, encoding: 'utf8', timeout: 2000 },
  );

  assert.equal(result.status, 0, result.stderr);
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0, `expected child PID, got ${result.stdout}`);
  t.after(() => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });

  // LaunchAgents terminate the original job process group when a one-shot
  // supervisor exits. Wait until the child has left that group, then emulate
  // the cleanup; it must remain alive.
  const deadline = Date.now() + 2000;
  let childGroupId;
  while (Date.now() < deadline) {
    const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
    childGroupId = Number(group.stdout.trim());
    if (group.status === 0 && Number.isInteger(childGroupId) && childGroupId !== result.pid) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.notEqual(childGroupId, result.pid, 'child must leave the one-shot supervisor process group');
  try {
    process.kill(-result.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.doesNotThrow(() => process.kill(pid, 0));
});
