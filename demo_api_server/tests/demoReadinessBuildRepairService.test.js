'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createBuildRepairService } = require('../services/demoReadinessBuildRepairService');
const { USE_CASES } = require('../config/useCases');

const CASE = { id: 'UC2.5', codeRefs: [...USE_CASES.find((row) => row.id === 'UC2.5').codeRefs] };
const FILE = CASE.codeRefs[0];
const UI_FILE = CASE.codeRefs[2];
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function fixtureRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-build-test-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Disposable Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  for (const ref of CASE.codeRefs) {
    fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true });
    fs.writeFileSync(path.join(root, ref), 'module.exports = false;\n');
  }
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  fs.mkdirSync(path.join(root, 'demo_api_server/tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'demo_api_server/tests/scenario.cjs'), "require('node:assert/strict').equal(require('../services/a2aOrchestratorService'), true);\n");
  fs.writeFileSync(path.join(root, 'demo_api_ui/scenario.cjs'), "require('node:assert/strict').equal(require('./src/components/AIAgent.js'), true);\n");
  fs.writeFileSync(path.join(root, 'demo_api_ui/package.json'), JSON.stringify({ scripts: { build: "node -e \"require('node:fs').mkdirSync('dist', {recursive:true}); require('node:fs').writeFileSync('dist/app.js', 'built');\"" } }));
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

function patchFor(ref = FILE) {
  return `diff --git a/${ref} b/${ref}\n--- a/${ref}\n+++ b/${ref}\n@@ -1 +1 @@\n-module.exports = false;\n+module.exports = true;\n`;
}

const PLAN = [
  { command: process.execPath, args: ['tests/scenario.cjs'], cwd: 'demo_api_server' },
  { command: process.execPath, args: ['scenario.cjs'], cwd: 'demo_api_ui' },
  { command: 'npm', args: ['run', 'build'], cwd: 'demo_api_ui' },
];

function configFixture({ flag = false, retryFails = false, restoreFails = false, corruptSource } = {}) {
  const repairClass = flag ? 'demo-feature-flag' : 'pingone-scope-addition';
  let value = flag ? false : ['read'];
  const expected = flag ? true : ['read', 'write'];
  let disposed = false;
  let calls = 0;
  const contexts = [];
  const contract = { target: 'local', object: { id: flag ? 'ff_demo' : 'resource-fixture' }, expected, sourceRef: 'fixture:declared', operation: 'Repair the disposable fixture' };
  const adapter = {
    createIsolatedWorker: async () => { const worker = {}; contexts.push(worker); return worker; },
    read: async ({ workerContext }) => { if (flag) expect(contexts).toContain(workerContext); return value; },
    write: async ({ workerContext }) => { if (flag) expect(contexts).toContain(workerContext); value = expected; if (corruptSource) corruptSource(); },
    readback: async () => value,
    restore: async ({ expected: original }) => { if (restoreFails) throw new Error('restore failed'); value = original; },
  };
  return {
    driftFixture: { repairClass, contract },
    adapters: {
      createFixture: async ({ directory }) => { expect(fs.existsSync(directory)).toBe(true); return { directory }; },
      introduceDrift: async () => ({ status: 'fail', repairCandidate: { repairClass, ...contract, current: value } }),
      repairAdapters: () => ({ [repairClass]: adapter }),
      sourceReaders: () => ({ [flag ? 'readinessWorkerFlag' : 'pingoneScopeTopology']: () => contract }),
      runScenario: async () => { calls += 1; return { status: !retryFails && JSON.stringify(value) === JSON.stringify(expected) ? 'pass' : 'fail' }; },
      disposeFixture: async () => { disposed = true; },
      patchProvider: () => { throw new Error('Configuration repair must never request a source patch'); },
    },
    state: () => ({ value, disposed, calls }),
  };
}

describe('isolated demo source repair', () => {
  let root;
  let service;
  beforeEach(() => { root = fixtureRepository(); service = createBuildRepairService({ repositoryRoot: root }); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test.each([false, true])('configuration-only proof repairs fixture (worker flag=%s), retries and preserves source', async (flag) => {
    const fixture = configFixture({ flag });
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('pass');
    expect(result.before.status).toBe('fail');
    expect(result.after.status).toBe('pass');
    expect(result.sourceHashBefore).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceHashAfter).toBe(result.sourceHashBefore);
    expect(result.preview.changes).toHaveLength(1);
    expect(fixture.state()).toEqual({ value: flag ? false : ['read', 'write'], disposed: true, calls: 2 });
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  test.each([{ retryFails: true }, { flag: true, restoreFails: true }])('failed retry or worker restoration blocks configuration proof: %j', async (options) => {
    const fixture = configFixture(options);
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(fixture.state().disposed).toBe(true);
  });

  test('source mutation during configuration repair fails the unchanged-source proof', async () => {
    const fixture = configFixture({ corruptSource: () => fs.appendFileSync(path.join(root, FILE), '// changed\n') });
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(result.sourceHashAfter).not.toBe(result.sourceHashBefore);
  });

  test('source hashing covers checked-in application configuration code even though patches cannot edit it', async () => {
    const ref = 'demo_api_server/config/localSettings.js';
    fs.mkdirSync(path.join(root, 'demo_api_server/config'), { recursive: true });
    fs.writeFileSync(path.join(root, ref), 'module.exports = false;\n');
    git(root, ['add', ref]);
    git(root, ['commit', '--quiet', '-m', 'config source fixture']);
    const fixture = configFixture({ corruptSource: () => fs.appendFileSync(path.join(root, ref), '// changed\n') });
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(result.sourceHashAfter).not.toBe(result.sourceHashBefore);
  });

  test('unrelated tracked documentation with spaces does not block application source hashing', async () => {
    const ref = 'Fixture Guide.md';
    fs.writeFileSync(path.join(root, ref), 'Disposable documentation\n');
    git(root, ['add', ref]);
    git(root, ['commit', '--quiet', '-m', 'documentation fixture']);
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...configFixture() });
    expect(result.status).toBe('pass');
    expect(result.sourceHashAfter).toBe(result.sourceHashBefore);
  });

  test.each(['existing', 'new'])('configuration proof detects mutation of %s untracked application source', async (kind) => {
    const ref = path.join(root, 'demo_api_server/services/untrackedScenario.js');
    if (kind === 'existing') fs.writeFileSync(ref, 'module.exports = false;\n');
    const fixture = configFixture({ corruptSource: () => fs.writeFileSync(ref, 'module.exports = true;\n') });
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(result.sourceHashAfter).not.toBe(result.sourceHashBefore);
  });

  test.each(['provider', 'check'])('source candidate detects %s mutation of caller tracked non-source and new/existing untracked source', async (mutator) => {
    const tracked = path.join(root, 'Case Guide.md');
    fs.writeFileSync(tracked, 'Original guide\n');
    git(root, ['add', 'Case Guide.md']);
    git(root, ['commit', '--quiet', '-m', 'caller guide fixture']);
    const existing = path.join(root, 'demo_api_server/services/untrackedScenario.js');
    const added = path.join(root, 'demo_api_server/services/newScenario.js');
    fs.writeFileSync(existing, 'module.exports = false;\n');
    const mutation = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(tracked)},'Changed guide');fs.writeFileSync(${JSON.stringify(existing)},'module.exports = true;');fs.writeFileSync(${JSON.stringify(added)},'module.exports = true;');`;
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD',
      patchProvider: async () => { if (mutator === 'provider') execFileSync(process.execPath, ['-e', mutation]); return patchFor(); },
      testPlan: [{ command: process.execPath, args: mutator === 'check' ? ['-e', mutation] : ['--version'] }],
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/caller.*changed/i);
    expect(result.patch).toBeUndefined();
    expect(git(root, ['worktree', 'list', '--porcelain']).match(/worktree /g)).toHaveLength(1);
  });

  test.each(['tracked document', 'existing untracked source', 'new untracked source'])('source candidate detects isolated caller mutation: %s', async (kind) => {
    const ref = kind === 'tracked document' ? 'Case Guide.md' : 'demo_api_server/services/callerScenario.js';
    const filename = path.join(root, ref);
    if (kind !== 'new untracked source') fs.writeFileSync(filename, 'Original\n');
    if (kind === 'tracked document') { git(root, ['add', ref]); git(root, ['commit', '--quiet', '-m', 'caller document fixture']); }
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD',
      patchProvider: async () => { fs.writeFileSync(filename, 'Changed\n'); return patchFor(); },
      testPlan: [{ command: process.execPath, args: ['--version'] }],
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/caller.*changed/i);
    expect(result.patch).toBeUndefined();
  });

  test('an untracked caller symlink blocks before requesting a candidate patch', async () => {
    fs.symlinkSync('/tmp', path.join(root, 'untrackedLink'));
    let requested = false;
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD',
      patchProvider: async () => { requested = true; return patchFor(); }, testPlan: [{ command: process.execPath, args: ['--version'] }],
    });
    expect(result.status).toBe('blocked');
    expect(requested).toBe(false);
  });

  test('configuration proof also detects tracked non-source mutation in the caller', async () => {
    fs.writeFileSync(path.join(root, 'Case Guide.md'), 'Original\n');
    git(root, ['add', 'Case Guide.md']);
    git(root, ['commit', '--quiet', '-m', 'caller guide fixture']);
    const fixture = configFixture({ corruptSource: () => fs.writeFileSync(path.join(root, 'Case Guide.md'), 'Changed\n') });
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/caller.*changed/i);
    expect(result.sourceHashAfter).toBe(result.sourceHashBefore);
  });

  test('Git snapshot enumeration excludes the protected fixture through its actual pathspec', async () => {
    const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-git-contract-'));
    const recorded = path.join(tools, 'argv.jsonl');
    const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = path.join(tools, 'git');
    fs.writeFileSync(wrapper, `#!${process.execPath}\nconst fs=require('node:fs');const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(args[0]==='ls-files')fs.appendFileSync(${JSON.stringify(recorded)},JSON.stringify(args)+'\\n');const result=spawnSync(${JSON.stringify(realGit)},args,{cwd:process.cwd(),stdio:'inherit'});process.exit(result.status===null?1:result.status);\n`, { mode: 0o755 });
    const prior = process.env.PATH;
    process.env.PATH = tools + path.delimiter + prior;
    try {
      const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...configFixture() });
      expect(result.status).toBe('pass');
      const calls = fs.readFileSync(recorded, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(calls.length).toBeGreaterThan(0);
      for (const argv of calls) {
        expect(argv).toContain('--');
        expect(argv).toContain(':(top,literal,exclude)demo_api_server/data/step-verification/pingone-admin/ADMIN7.chip.unit-parse.json');
      }
    } finally {
      process.env.PATH = prior;
      fs.rmSync(tools, { recursive: true, force: true });
    }
  });

  test('passing service/UI tests and UI build return only an uncommitted review patch and remove the worktree', async () => {
    fs.appendFileSync(path.join(root, FILE), '// caller dirty edit\n');
    const before = git(root, ['diff']);
    const index = fs.readFileSync(path.join(root, '.git/index'));
    const head = git(root, ['rev-parse', 'HEAD']);
    let worker;
    const result = await service.prepareSourceFix({
      caseRow: CASE, sanitizedFailure: { kind: 'source-defect', evidence: 'Bearer sensitive-token' }, baseRevision: 'HEAD', testPlan: PLAN,
      patchProvider: async (input) => { worker = input.worktreePath; expect(worker).not.toBe(root); expect(input.sanitizedFailure.evidence).not.toContain('sensitive-token'); return patchFor() + patchFor(UI_FILE); },
    });
    expect(result.status).toBe('verified');
    expect(result.patch).toContain('+module.exports = true;');
    expect(result.diff).toBe(result.patch);
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence.every((row) => row.exitCode === 0)).toBe(true);
    expect(result.reviewerAction).toMatch(/review/i);
    expect(fs.existsSync(worker)).toBe(false);
    expect(git(root, ['worktree', 'list', '--porcelain']).match(/worktree /g)).toHaveLength(1);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(root, ['diff'])).toBe(before);
    expect(fs.readFileSync(path.join(root, '.git/index'))).toEqual(index);
  });

  test.each([
    ['path traversal', patchFor('../escape.js')],
    ['absolute path', patchFor('/tmp/escape.js')],
    ['configuration', patchFor('demo_api_server/config/scopes.js')],
    ['secret file', patchFor('.env')],
    ['generated file', patchFor('demo_api_ui/dist/app.js')],
    ['outside allowlist', patchFor('demo_api_server/services/oauthService.js')],
    ['shell commands', 'echo shell > outside\n'],
    ['commands after patch', patchFor() + 'echo shell > outside\n'],
    ['symlink mode', patchFor().replace('--- a/', 'new file mode 120000\n--- a/')],
    ['provider command object', { patch: patchFor(), command: 'echo shell' }],
  ])('rejects %s and discards its candidate', async (_label, patch) => {
    let worker;
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD', testPlan: PLAN,
      patchProvider: async ({ worktreePath }) => { worker = worktreePath; return patch; } });
    expect(result.status).toBe('blocked');
    expect(result.patch).toBeUndefined();
    expect(fs.existsSync(worker)).toBe(false);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  test.each([
    ['test', [{ command: process.execPath, args: ['-e', 'console.error("Bearer private-fixture-token");process.exit(1)'] }]],
    ['build', [...PLAN.slice(0, 2), { command: process.execPath, args: ['-e', 'process.exit(1)'], cwd: 'demo_api_ui' }]],
  ])('a failing focused %s removes candidate and returns sanitized blocked evidence', async (_kind, testPlan) => {
    let worker;
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD', testPlan,
      patchProvider: async ({ worktreePath }) => { worker = worktreePath; return patchFor() + patchFor(UI_FILE); } });
    expect(result.status).toBe('blocked');
    expect(result.evidence.at(-1).exitCode).toBe(1);
    expect(JSON.stringify(result)).not.toContain('private-fixture-token');
    expect(result.patch).toBeUndefined();
    expect(fs.existsSync(worker)).toBe(false);
  });

  test.each([
    [{ id: 'UC2.5', codeRefs: [FILE, 'demo_api_server/services/oauthService.js'] }, { kind: 'source-defect' }, PLAN],
    [{ id: 'ADMIN1', codeRefs: [] }, { kind: 'source-defect' }, PLAN],
    [CASE, { kind: 'configuration', configRecovery: { status: 'pass' } }, PLAN],
    [CASE, { kind: 'source-defect', configRecovery: { status: 'pass' } }, PLAN],
    [CASE, { kind: 'source-defect' }, [{ command: 'node', args: [], cwd: '../outside' }]],
    [CASE, { kind: 'source-defect' }, [{ command: 'node', args: [], shell: true }]],
  ])('invalid case/failure/plan cannot request a source patch', async (caseRow, sanitizedFailure, testPlan) => {
    let requested = false;
    const result = await service.prepareSourceFix({ caseRow, sanitizedFailure, testPlan, baseRevision: 'HEAD', patchProvider: async () => { requested = true; return patchFor(); } });
    expect(result.status).toBe('blocked');
    expect(requested).toBe(false);
  });

  test('symlinked declared code reference fails closed before requesting a patch', async () => {
    fs.unlinkSync(path.join(root, FILE));
    fs.symlinkSync('/tmp', path.join(root, FILE));
    git(root, ['add', FILE]);
    git(root, ['commit', '--quiet', '-m', 'unsafe fixture']);
    let requested = false;
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD', testPlan: PLAN,
      patchProvider: async () => { requested = true; return patchFor(); } });
    expect(result.status).toBe('blocked');
    expect(requested).toBe(false);
  });

  test('fixture disposal failure remains blocked and still removes its temporary directory', async () => {
    const fixture = configFixture();
    let directory;
    fixture.adapters.createFixture = async (input) => { directory = input.directory; return { directory }; };
    fixture.adapters.disposeFixture = async () => { throw new Error('dispose fixture failed'); };
    const result = await service.validateConfigOnlyRecovery({ caseRow: CASE, ...fixture });
    expect(result.status).toBe('blocked');
    expect(fs.existsSync(directory)).toBe(false);
  });

  test('candidate checks cannot leave staged/committed source or modify its verified patch', async () => {
    const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD',
      testPlan: [{ command: 'git', args: ['add', FILE] }], patchProvider: async () => patchFor() });
    expect(result.status).toBe('blocked');
    expect(result.patch).toBeUndefined();
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  test('trusted checks execute argv without shell expansion or inherited demo credentials', async () => {
    const prior = process.env.PINGONE_CLIENT_SECRET;
    process.env.PINGONE_CLIENT_SECRET = 'private-parent-credential';
    try {
      const result = await service.prepareSourceFix({ caseRow: CASE, sanitizedFailure: { kind: 'source-defect' }, baseRevision: 'HEAD',
        patchProvider: async () => patchFor(),
        testPlan: [{ command: process.execPath, args: ['-e', "const assert=require('node:assert/strict');assert.equal(process.argv[1], '$(touch shell-marker)');assert.equal(process.env.PINGONE_CLIENT_SECRET, undefined);", '$(touch shell-marker)'] }],
      });
      expect(result.status).toBe('verified');
      expect(result.evidence[0].exitCode).toBe(0);
      expect(fs.existsSync(path.join(root, 'shell-marker'))).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.PINGONE_CLIENT_SECRET;
      else process.env.PINGONE_CLIENT_SECRET = prior;
    }
  });
});

test('Admin Reset Demo handles a supplied patch request without invoking the build-time workflow', async () => {
  const express = require('express');
  const request = require('supertest');
  let patchRequests = 0;
  let resetEvents = 0;
  const mocks = {
    '../services/demoReadinessBuildRepairService': { prepareSourceFix: () => { patchRequests += 1; throw new Error('runtime source repair forbidden'); } },
    '../data/store': {},
    '../middleware/auth': { authenticateToken: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(), requireScopes: () => (_req, _res, next) => next() },
    '../config/runtimeSettings': {},
    '../services/pingOneUserLookupService': {},
    '../services/pingOneAuthorizeService': {},
    '../services/pingoneBootstrapService': {},
    '../services/configStore': { setRaw: async () => {} },
    '../services/transactionAuthorizationService': {},
    '../services/oauthVerboseLogStore': {},
    '../services/killSwitchService': {},
    '../services/killSwitchSseHub': {},
    '../services/auditLogService': {},
    '../services/agentLifecycleEvents': {},
    '../services/sessionKeyService': {},
    '../services/agentRunRegistry': {},
    '../services/appEventService': { clearEvents: () => { resetEvents += 1; } },
    '../services/tokenChainService': { clearAllTokenChains: () => {} },
    '../services/mcpToolAuditStore': { clearToolCalls: () => {} },
    '../services/apiCallTrackerService': { clearApiCalls: () => {} },
    '../routes/featureFlags': { FLAG_REGISTRY: [] },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({});
  try {
    let router;
    jest.isolateModules(() => {
      for (const [ref, value] of Object.entries(mocks)) jest.doMock(ref, () => value);
      router = require('../routes/admin');
    });
    const app = express();
    app.use(express.json());
    app.use('/api/admin', router);
    const response = await request(app).post('/api/admin/reset-demo').send({ sourceFix: { caseRow: CASE, patch: patchFor() } });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(resetEvents).toBe(1);
    expect(patchRequests).toBe(0);
  } finally {
    global.fetch = originalFetch;
    for (const ref of Object.keys(mocks)) jest.dontMock(ref);
  }
});
