'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const contractVerticals = require(path.join(
  repoRoot,
  'demo_api_server',
  'config',
  'useCases',
)).VERTICALS;

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

test('UI Docker build can run the cross-repo readiness contract against its context', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'demo_api_ui', 'Dockerfile'), 'utf8');
  const dockerignore = fs.readFileSync(
    path.join(repoRoot, 'demo_api_ui', 'Dockerfile.dockerignore'),
    'utf8',
  );
  const exceptions = new Set(dockerignore.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('!'))
    .map((line) => line.slice(1)));

  const contractRun = String.raw`RUN --mount=type=bind,source=.,target=/workspace \
    node /workspace/scripts/check-demo-readiness-contract.mjs`;
  assert.ok(
    dockerfile.includes(contractRun),
    'the UI image builder must run the same readiness contract from the repo context',
  );
  assert.ok(
    dockerfile.includes('RUN node scripts/sync-topology-exports.mjs && ./node_modules/.bin/vite build'),
    'the UI image builder must run the topology sync and Vite after the root contract check',
  );

  const requiredRules = [
    'scripts/',
    'scripts/check-demo-readiness-contract.mjs',
    'scope-topology.json',
    'ping-gateway/',
    'ping-gateway/config/scope-topology.json',
    'demo_api_server/',
    'demo_api_server/config/',
    'demo_api_server/config/a2aSpecialists.js',
    'demo_api_server/config/auth-requirements.json',
    'demo_api_server/config/demoReadinessFeatureChecks.json',
    'demo_api_server/config/demoReadinessInventory.json',
    'demo_api_server/config/demoReadinessPingFederateProfiles.json',
    'demo_api_server/config/demoReadinessRepairability.json',
    'demo_api_server/config/useCases.js',
    'demo_api_server/config/admin/demoSteps.js',
    ...contractVerticals.map((vertical) => `demo_api_server/config/verticals/${vertical}/manifest.json`),
    'demo_api_server/services/',
    'demo_api_server/services/demoReadinessCatalog.js',
    'demo_api_server/services/demoStepPrerequisites.js',
    'demo_api_server/services/scopeTopology.js',
    'demo_api_server/routes/',
    'demo_api_server/routes/intentBinding.js',
    'demo_api_server/tests/',
    'demo_api_server/tests/demoReadinessExecutionService.test.js',
    'demo_api_server/tests/routes/pfDavinciAuth.test.js',
    'demo_api_ui',
    'demo_api_ui/**',
    'demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js',
  ];
  for (const rule of requiredRules) {
    assert.ok(exceptions.has(rule), `UI Docker build context is missing !${rule}`);
  }
  for (const excludedPath of [
    'demo_api_server/**/node_modules',
    'demo_api_server/**/data',
    'demo_api_server/**/logs',
    'demo_api_server/**/.env',
    'demo_api_server/**/.env.*',
    'demo_api_server/**/test-results',
    'demo_api_ui/.env*',
    'demo_api_ui/**/.env*',
  ]) {
    assert.ok(
      dockerignore.split(/\r?\n/).map((line) => line.trim()).includes(excludedPath),
      `UI Docker build context must exclude ${excludedPath}`,
    );
  }
  const broadExceptions = [
    '!scripts/**',
    '!docs/**',
    '!demo_api_server/**',
    '!demo_api_server/config/**',
    '!demo_api_server/services/**',
    '!demo_api_server/tests/**',
    '!demo_api_ui/tests/**',
  ];
  for (const broadException of broadExceptions) {
    assert.ok(
      !dockerignore.split(/\r?\n/).map((line) => line.trim()).includes(broadException),
      `UI Docker build context must not broadly re-include ${broadException}`,
    );
  }

  const featureChecks = require(path.join(
    repoRoot,
    'demo_api_server',
    'config',
    'demoReadinessFeatureChecks.json',
  )).checks;
  const featureRefs = featureChecks.flatMap((check) => [
    check.sourceRef,
    ...(check.relatedTests || []).map((relatedTest) => relatedTest.sourceRef),
  ]).filter(Boolean).map((sourceRef) => sourceRef.split('#', 1)[0]);
  for (const sourceRef of featureRefs) {
    const included = exceptions.has(sourceRef)
      || (sourceRef.startsWith('demo_api_ui/src/') && exceptions.has('demo_api_ui/**'));
    assert.ok(included, `UI Docker build context does not include readiness source ${sourceRef}`);
  }
});

test('UI Docker context uses Docker ignore semantics to exclude runtime and unrelated files', {
  skip: (() => {
    const result = spawnSync('docker', ['buildx', 'version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) return 'Docker Buildx is unavailable';
    const daemon = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return daemon.status === 0 ? false : 'Docker daemon is unavailable';
  })(),
}, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-demo-ui-dockerignore-'));
  const contextRoot = path.join(fixtureRoot, 'context');
  const outputRoot = path.join(fixtureRoot, 'output');
  fs.mkdirSync(contextRoot);
  fs.copyFileSync(
    path.join(repoRoot, 'demo_api_ui', 'Dockerfile.dockerignore'),
    path.join(contextRoot, '.dockerignore'),
  );
  fs.writeFileSync(path.join(contextRoot, 'Dockerfile'), 'FROM scratch\nCOPY . /context\n');

  const writeFixtureFile = (relativePath) => {
    const filePath = path.join(contextRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `fixture: ${relativePath}\n`);
  };
  const expectedIncluded = [
    'scripts/check-demo-readiness-contract.mjs',
    'scope-topology.json',
    'ping-gateway/config/scope-topology.json',
    'docs/exports/server-topology-lucidchart.csv',
    'docs/exports/server-topology-details.csv',
    'demo_api_server/config/a2aSpecialists.js',
    'demo_api_server/config/auth-requirements.json',
    'demo_api_server/config/admin/demoSteps.js',
    ...contractVerticals.map((vertical) => `demo_api_server/config/verticals/${vertical}/manifest.json`),
    'demo_api_server/services/demoReadinessCatalog.js',
    'demo_api_server/services/demoStepPrerequisites.js',
    'demo_api_server/tests/demoReadinessExecutionService.test.js',
    'demo_api_server/tests/routes/pfDavinciAuth.test.js',
    'demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js',
  ];
  const expectedExcluded = [
    'scripts/unrelated-maintenance.js',
    'demo_api_server/logs/readiness-probe.log',
    'demo_api_server/banking_api_server/data/runtime-secret.json',
    'demo_api_server/banking_api_server/.env.local',
    'demo_api_ui/.env.local',
    'demo_api_ui/tests/unit/unrelated.test.jsx',
    'docs/private-demo-notes.md',
  ];
  for (const relativePath of [...expectedIncluded, ...expectedExcluded]) writeFixtureFile(relativePath);

  try {
    const result = spawnSync('docker', [
      'buildx', 'build', '--progress=plain', '--output', `type=local,dest=${outputRoot}`,
      contextRoot,
    ], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const relativePath of expectedIncluded) {
      assert.ok(
        fs.existsSync(path.join(outputRoot, 'context', relativePath)),
        `Docker excluded required readiness input ${relativePath}`,
      );
    }
    for (const relativePath of expectedExcluded) {
      assert.ok(
        !fs.existsSync(path.join(outputRoot, 'context', relativePath)),
        `Docker included unrelated or runtime file ${relativePath}`,
      );
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('BFF runtime layout resolves topology files from the packaged repository root', () => {
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

    // Apply the Dockerfile COPY destinations for both topology inputs to the
    // simulated image root, then load the catalog from its image path. This
    // proves the runtime root resolver and the Dockerfile layout agree.
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'demo_api_server', 'Dockerfile'), 'utf8');
    const topologySources = new Set([
      'scope-topology.json',
      'ping-gateway/config/scope-topology.json',
    ]);
    const destinations = new Map([...topologySources].map((source) => [source, []]));
    for (const line of dockerfile.split(/\r?\n/)) {
      const match = line.match(/^\s*COPY\s+(.+)$/);
      if (!match) continue;
      const parts = match[1].trim().split(/\s+/);
      const destination = parts.at(-1);
      for (const source of parts.slice(0, -1)) {
        const normalizedSource = source.replace(/\/$/, '');
        if (topologySources.has(normalizedSource)) {
          destinations.get(normalizedSource).push(destination);
        }
      }
    }

    for (const [source, copies] of destinations) {
      const sourceFile = path.join(stagedBff, source);
      assert.ok(fs.existsSync(sourceFile), `BFF build context is missing ${source}`);
      assert.ok(copies.length > 0, `Dockerfile does not copy ${source} into the BFF image`);
      for (const destination of copies) {
        const runtimeFile = path.join(runtimeRoot, destination.replace(/^\/+/, ''));
        fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
        fs.copyFileSync(sourceFile, runtimeFile);
      }
    }

    const stagedApp = path.join(stagedBff, 'demo_api_server');
    const runtimeApp = path.join(runtimeRoot, 'app');
    fs.cpSync(stagedApp, runtimeApp, { recursive: true });
    fs.symlinkSync(path.join(repoRoot, 'demo_api_server', 'node_modules'), path.join(runtimeApp, 'node_modules'), 'dir');

    const catalogPath = path.join(runtimeApp, 'services', 'demoReadinessCatalog.js');
    const catalog = require(catalogPath);
    const { resolveRepositoryRoot } = require(path.join(runtimeApp, 'utils', 'repositoryRoot.js'));
    const resolvedRoot = resolveRepositoryRoot(path.dirname(catalogPath), {
      repositoryMount: path.join(outputRoot, 'unmounted-repo'),
    });
    assert.equal(resolvedRoot, runtimeRoot);

    const sources = catalog.loadDemoReadinessSources({ repositoryRoot: resolvedRoot });
    assert.deepEqual(
      sources.scopeTopology,
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'scope-topology.json'), 'utf8')),
    );
    assert.deepEqual(
      sources.gatewayScopeTopology,
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'ping-gateway/config/scope-topology.json'), 'utf8')),
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
