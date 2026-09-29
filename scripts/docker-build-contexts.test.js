'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('BFF build context includes the readiness audit helper scripts', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-demo-bff-context-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, 'docker-build-contexts.js'),
      repoRoot,
      outputRoot,
      'bff',
    ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const script of [
      'check-demo-health-gate.js',
      'check-mcp-preflight.js',
      'lib/preflightRows.js',
    ]) {
      assert.ok(
        fs.existsSync(path.join(outputRoot, 'bff', 'scripts', script)),
        `BFF build context is missing scripts/${script}`,
      );
    }

    const runtimeRoot = path.join(outputRoot, 'runtime');
    const serviceDirectory = path.join(runtimeRoot, 'app', 'services');
    fs.mkdirSync(serviceDirectory, { recursive: true });
    fs.cpSync(path.join(outputRoot, 'bff', 'scripts'), path.join(runtimeRoot, 'scripts'), { recursive: true });
    const probePath = path.join(serviceDirectory, 'readiness-import-probe.js');
    fs.writeFileSync(probePath, [
      "module.exports = [require('../../scripts/check-demo-health-gate'), require('../../scripts/check-mcp-preflight')];",
      '',
    ].join('\n'));

    const [healthGate, mcpPreflight] = require(probePath);
    assert.equal(typeof healthGate.fetchJson, 'function');
    assert.equal(typeof mcpPreflight.probe, 'function');
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
