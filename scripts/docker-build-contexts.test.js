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

    const stagedBff = path.join(outputRoot, 'bff');
    fs.symlinkSync(
      path.join(repoRoot, 'demo_api_server', 'node_modules'),
      path.join(stagedBff, 'demo_api_server', 'node_modules'),
      'dir',
    );
    const auditService = require(path.join(
      stagedBff,
      'demo_api_server',
      'services',
      'demoReadinessAuditService.js',
    ));
    assert.equal(typeof auditService.createAuditService, 'function');
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
