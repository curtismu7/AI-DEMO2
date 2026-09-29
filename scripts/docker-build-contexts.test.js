'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
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

test('BFF runtime layout resolves the gateway topology imported by the readiness catalog', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-demo-bff-runtime-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, 'docker-build-contexts.js'),
      repoRoot,
      outputRoot,
      'bff',
    ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const stagedBff = path.join(outputRoot, 'bff');
    const runtimeRoot = path.join(outputRoot, 'runtime');

    // Apply the Dockerfile COPY destinations for the gateway topology input to
    // the simulated image root. Loading the real catalog proves the destination
    // agrees with the module's relative require, rather than just proving the
    // source file exists somewhere in the build context.
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'demo_api_server', 'Dockerfile'), 'utf8');
    const topologySource = 'ping-gateway/config/scope-topology.json';
    const topologySourceFile = path.join(stagedBff, topologySource);
    assert.ok(fs.existsSync(topologySourceFile), `BFF build context is missing ${topologySource}`);

    const destinations = [];
    for (const line of dockerfile.split(/\r?\n/)) {
      const match = line.match(/^\s*COPY\s+(.+)$/);
      if (!match) continue;
      const parts = match[1].trim().split(/\s+/);
      const destination = parts.at(-1);
      for (const source of parts.slice(0, -1)) {
        const normalizedSource = source.replace(/\/$/, '');
        if (normalizedSource === topologySource) {
          destinations.push(destination);
        } else if (normalizedSource === 'ping-gateway') {
          destinations.push(path.posix.join(destination, 'config/scope-topology.json'));
        }
      }
    }

    for (const destination of destinations) {
      const runtimeFile = path.join(runtimeRoot, destination.replace(/^\/+/, ''));
      fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
      fs.copyFileSync(topologySourceFile, runtimeFile);
    }

    const catalogSource = fs.readFileSync(
      path.join(stagedBff, 'demo_api_server', 'services', 'demoReadinessCatalog.js'),
      'utf8',
    );
    const gatewayTopologyImport = [...catalogSource.matchAll(/require\(['"]([^'"]*scope-topology\.json)['"]\)/g)]
      .map((match) => match[1])
      .find((specifier) => specifier.includes('ping-gateway'));
    assert.ok(gatewayTopologyImport, 'readiness catalog must import the PingGateway scope topology');

    const requireFromCatalog = Module.createRequire(
      path.join(runtimeRoot, 'app', 'services', 'demoReadinessCatalog.js'),
    );
    const resolvedTopology = requireFromCatalog.resolve(gatewayTopologyImport);
    const relativeTopologyPath = path.relative(fs.realpathSync(runtimeRoot), resolvedTopology);
    assert.ok(
      relativeTopologyPath && relativeTopologyPath !== '..' && !relativeTopologyPath.startsWith(`..${path.sep}`),
      `catalog import resolved outside the simulated BFF image: ${resolvedTopology}`,
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
