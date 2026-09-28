'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, runCli } = require('./demo-readiness');

test('defaults to both targets, supports one diagnostic target and JSON', () => {
  assert.deepEqual(parseArgs([]), { targets: ['local', 'se'], json: false, help: false });
  assert.deepEqual(parseArgs(['--target', 'se', '--json']), { targets: ['se'], json: true, help: false });
  assert.throws(() => parseArgs(['--target', 'bad']), /local\|se\|both/);
});

test('help documents both targets and digest-bound repair confirmation', async () => {
  let output = '';
  const code = await runCli(['--help'], { stdout: { write: (value) => { output += value; } } });
  assert.equal(code, 0);
  assert.match(output, /--target local\|se\|both/);
  assert.match(output, /exact repair plan digest/);
  assert.match(output, /no verified administrator/);
  assert.match(output, /Admin sidebar Reset Demo/);
});

test('prints complete preview before one exact-digest prompt and redacts output', async () => {
  const events = [];
  let prompts = 0;
  const start = async ({ confirmRepairs, onProgress, targets }) => {
    assert.deepEqual(targets, ['local', 'se']);
    await onProgress({ phase: 'repair-preview-ready', preview: { digest: 'd1', changes: [{ operation: 'set', client_secret: 'sensitive' }], blocked: [] } });
    const answer = await confirmRepairs({ digest: 'd1', preview: { digest: 'd1', changes: [{ operation: 'set', client_secret: 'sensitive' }], blocked: [] } });
    assert.equal(answer, 'd1');
    return { ready: false, status: 'not-ready', label: 'NOT READY', report: { evidence: 'Bearer abc' } };
  };
  const code = await runCli([], {
    start,
    stdout: { write: (value) => events.push('out:' + value) },
    stderr: { write: (value) => events.push('err:' + value) },
    confirm: async (prompt, context) => { prompts += 1; assert.equal(events.length > 0, true); assert.match(prompt, /d1/); assert.equal(context.digest, 'd1'); return 'd1'; },
  });
  assert.equal(prompts, 1);
  assert.equal(code, 1);
  const output = events.join('\n');
  assert.match(output, /"changes"/);
  assert.doesNotMatch(output, /sensitive|Bearer abc/);
});

test('JSON mode emits machine-readable summary and exit 0 only for full READY', async () => {
  let output = '';
  const code = await runCli(['--json'], {
    start: async () => ({ ready: true, status: 'ready', label: 'READY — BOTH TARGETS', report: { checks: [] } }),
    stdout: { write: (value) => { output += value; } },
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output).ready, true);
  assert.equal(JSON.parse(output).label, 'READY — BOTH TARGETS');
});

test('single-target success stays diagnostic and exits nonzero', async () => {
  let output = '';
  const code = await runCli(['--target', 'local'], {
    start: async () => ({ ready: false, status: 'not-ready', label: 'DIAGNOSTIC — LOCAL ONLY' }),
    stdout: { write: (value) => { output += value; } },
  });
  assert.equal(code, 1);
  assert.match(output, /DIAGNOSTIC/);
});
