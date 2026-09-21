import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const smokeScript = path.join(scriptsDir, 'vite-resolve-smoke.mjs');
const uiRoot = path.resolve(scriptsDir, '..');

test('Vite resolve smoke exits cleanly after closing its middleware server', () => {
  const result = spawnSync(process.execPath, [smokeScript], {
    cwd: uiRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /vite-resolve-smoke: ok/);
});
