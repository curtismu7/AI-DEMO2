'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCli, patchFileProvider } = require('./demo-readiness-build-fix');

test('help describes offline patch input, trusted argv checks, and review-only output', async () => {
  let output = '';
  const code = await runCli(['--help'], { stdout: { write: (value) => { output += value; } } });
  assert.equal(code, 0);
  assert.match(output, /--patch-file/);
  assert.match(output, /--test-plan/);
  assert.match(output, /uncommitted/);
});

test('patch-file provider returns data verbatim and never executes shell text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-cli-patch-'));
  try {
    const marker = path.join(root, 'marker');
    const file = path.join(root, 'candidate.diff');
    fs.writeFileSync(file, `touch ${marker}\n`);
    assert.equal(await patchFileProvider(file)(), `touch ${marker}\n`);
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI passes checked-in case refs and independent trusted test plan and sanitizes results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-cli-input-'));
  let output = '';
  try {
    const patch = path.join(root, 'candidate.diff');
    const plan = path.join(root, 'checks.json');
    fs.writeFileSync(patch, 'diff data');
    fs.writeFileSync(plan, JSON.stringify([{ command: 'node', args: ['--version'] }]));
    const code = await runCli(['--case', 'UC2.5', '--base', 'HEAD', '--patch-file', patch, '--test-plan', plan], {
      stdout: { write: (value) => { output += value; } },
      prepareSourceFix: async ({ caseRow, testPlan, patchProvider, sanitizedFailure }) => {
        assert.equal(caseRow.id, 'UC2.5');
        assert.ok(caseRow.codeRefs.includes('demo_api_ui/src/components/AIAgent.js'));
        assert.deepEqual(testPlan, [{ command: 'node', args: ['--version'] }]);
        assert.equal(await patchProvider(), 'diff data');
        assert.equal(sanitizedFailure.kind, 'source-defect');
        return { status: 'verified', evidence: 'Bearer private-cli-token' };
      },
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(output).status, 'verified');
    assert.doesNotMatch(output, /private-cli-token/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing/unknown arguments fail without starting a candidate', async () => {
  for (const args of [[], ['--commands', 'touch'], ['--case', 'bad']]) {
    let started = false;
    const code = await runCli(args, { stderr: { write: () => {} }, prepareSourceFix: async () => { started = true; } });
    assert.equal(code, 2);
    assert.equal(started, false);
  }
});

test('demo:ready does not invoke source provider even if supplied through adapters', async () => {
  const { runCli: runReadiness } = require('./demo-readiness');
  let requested = false;
  const code = await runReadiness(['--target', 'local', '--json'], {
    stdout: { write: () => {} },
    adapters: {
      patchProvider: () => { requested = true; throw new Error('runtime source patch forbidden'); },
      providerIsolation: { createProviderSession: async () => { throw new Error('disposable worker unavailable'); } },
      audit: async () => ({ findings: [{ id: 'fixture:source-defect', status: 'blocked', required: true }] }),
    },
  });
  assert.equal(code, 1);
  assert.equal(requested, false);
});
