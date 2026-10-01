'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { DashboardDataError, buildSnapshot, createGitHubReader, normalizeJob, normalizeRun } = require('./github');

function run(id, createdAt, status = 'queued', conclusion = null) {
  return {
    id,
    workflow_id: 12,
    name: 'CI',
    display_title: `workflow ${id}`,
    event: 'pull_request',
    status,
    conclusion,
    head_branch: 'main',
    created_at: createdAt,
    run_started_at: status === 'in_progress' ? createdAt : null,
    updated_at: createdAt,
    run_completed_at: status === 'completed' ? createdAt : null,
    html_url: `https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/${id}`,
  };
}

test('normalizeRun maps GitHub workflow run fields to the dashboard contract', () => {
  assert.deepEqual(normalizeRun(run(12, '2026-09-28T10:02:00Z')), {
    id: 12,
    workflowId: 12,
    workflow: 'CI',
    title: 'workflow 12',
    branch: 'main',
    event: 'pull_request',
    status: 'queued',
    conclusion: null,
    createdAt: '2026-09-28T10:02:00Z',
    startedAt: null,
    updatedAt: '2026-09-28T10:02:00Z',
    completedAt: null,
    runCompletedAt: null,
    url: 'https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/12',
  });
});

test('normalizeJob preserves status, timing, and available runner details', () => {
  assert.deepEqual(normalizeJob({
    id: 87,
    name: 'UI tests',
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-09-28T10:03:00Z',
    completed_at: null,
    runner_name: 'cmuir-dev-mac',
    runner_group_name: 'Default',
    labels: ['self-hosted', 'macOS'],
  }), {
    id: 87,
    name: 'UI tests',
    status: 'in_progress',
    conclusion: null,
    startedAt: '2026-09-28T10:03:00Z',
    completedAt: null,
    runnerName: 'cmuir-dev-mac',
    runnerGroup: 'Default',
    labels: ['self-hosted', 'macOS'],
    steps: [],
  });
});

test('normalizeJob represents an unassigned queued job without inventing a runner', () => {
  const job = normalizeJob({ id: 2, name: 'Gates', status: 'queued', labels: ['self-hosted'] });
  assert.equal(job.runnerName, null);
  assert.equal(job.runnerGroup, null);
  assert.deepEqual(job.labels, ['self-hosted']);
  assert.equal(job.startedAt, null);
});

test('buildSnapshot orders queued runs oldest-first and limits completed history to five', () => {
  const snapshot = buildSnapshot({
    repository: 'cmuir_pingcorp/AI-DEMO2',
    queuedRuns: [run(12, '2026-09-28T10:02:00Z'), run(11, '2026-09-28T10:01:00Z')],
    runningRuns: [run(20, '2026-09-28T10:00:00Z', 'in_progress')],
    completedRuns: Array.from({ length: 7 }, (_, i) => run(30 + i, `2026-09-28T09:${String(i).padStart(2, '0')}:00Z`, 'completed', i % 2 ? 'failure' : 'success')),
    jobsByRun: { 11: [{ id: 4, name: 'Gates' }] },
    now: new Date('2026-09-28T10:03:00Z'),
  });

  assert.deepEqual(snapshot.runs.slice(0, 3).map((item) => item.id), [11, 12, 20]);
  assert.equal(snapshot.runs.filter((item) => item.status === 'completed').length, 5);
  assert.deepEqual(snapshot.runs[0].jobs, [{ id: 4, name: 'Gates' }]);
  assert.deepEqual(snapshot.summary, { queued: 2, inProgress: 1, succeeded: 3, failed: 2 });
  assert.equal(snapshot.repository, 'cmuir_pingcorp/AI-DEMO2');
  assert.equal(snapshot.updatedAt, '2026-09-28T10:03:00.000Z');
});

test('buildSnapshot does not count skipped or neutral runs as failures', () => {
  const snapshot = buildSnapshot({
    repository: 'cmuir_pingcorp/AI-DEMO2',
    completedRuns: [
      run(51, '2026-09-28T09:00:00Z', 'completed', 'skipped'),
      run(52, '2026-09-28T09:01:00Z', 'completed', 'neutral'),
      run(53, '2026-09-28T09:02:00Z', 'completed', 'cancelled'),
    ],
    now: new Date('2026-09-28T10:03:00Z'),
  });

  assert.deepEqual(snapshot.summary, { queued: 0, inProgress: 0, succeeded: 0, failed: 1 });
});

function fakeSpawner(handler) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(async () => {
      try {
        const result = await handler({ command, args, options, callNumber: calls.length });
        child.stdout.end(result.stdout || '');
        child.stderr.end(result.stderr || '');
        child.emit('close', result.code ?? 0);
      } catch (error) {
        child.emit('error', error);
      }
    });
    return child;
  };
  return { spawn, calls };
}

test('createGitHubReader reads active jobs with fixed gh arguments and no shell', async () => {
  const queued = run(41, '2026-09-28T10:01:00Z');
  const completed = run(39, '2026-09-28T09:00:00Z', 'completed', 'success');
  const { spawn, calls } = fakeSpawner(({ args }) => {
    if (args[0] === 'repo') return { stdout: 'cmuir_pingcorp/AI-DEMO2\n' };
    const endpoint = args[1];
    if (endpoint.includes('status=queued')) return { stdout: JSON.stringify({ workflow_runs: [queued] }) };
    if (endpoint.includes('status=waiting') || endpoint.includes('status=pending') || endpoint.includes('status=requested')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (endpoint.includes('status=in_progress')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (endpoint.includes('status=completed')) return { stdout: JSON.stringify({ workflow_runs: [completed] }) };
    if (endpoint.endsWith('/41/jobs?per_page=100&page=1')) {
      return { stdout: JSON.stringify({ jobs: [{ id: 410, name: 'Gates', status: 'queued', labels: ['self-hosted'] }] }) };
    }
    if (endpoint.endsWith('/39/jobs?per_page=100&page=1')) return { stdout: JSON.stringify({ jobs: [] }) };
    assert.fail(`unexpected gh api endpoint: ${endpoint}`);
  });
  const reader = createGitHubReader({ spawn, now: () => new Date('2026-09-28T10:03:00Z') });

  const snapshot = await reader.getSnapshot();

  assert.equal(snapshot.repository, 'cmuir_pingcorp/AI-DEMO2');
  assert.equal(snapshot.runs[0].jobs[0].status, 'queued');
  assert.equal(snapshot.runs[1].jobs.length, 0);
  assert.ok(calls.every((call) => call.command === 'gh' && call.options.shell === false));
  assert.ok(calls.every((call) => !call.args.some((arg) => /auth token|secret|password/i.test(arg))));
});

test('createGitHubReader turns missing gh into a safe actionable error', async () => {
  const { spawn } = fakeSpawner(() => { throw Object.assign(new Error('private machine path'), { code: 'ENOENT' }); });
  const reader = createGitHubReader({ spawn });

  await assert.rejects(reader.getSnapshot(), (error) => {
    assert.ok(error instanceof DashboardDataError);
    assert.equal(error.code, 'GH_MISSING');
    assert.match(error.message, /Install gh and run gh auth login/);
    assert.doesNotMatch(error.message, /private machine path/);
    return true;
  });
});

test('createGitHubReader sanitizes authentication failures from gh stderr', async () => {
  const { spawn } = fakeSpawner(({ args }) => {
    if (args[0] === 'repo') return { stdout: 'cmuir_pingcorp/AI-DEMO2\n' };
    return { code: 1, stderr: 'HTTP 401 Bad credentials token=private-value' };
  });
  const reader = createGitHubReader({ spawn });

  await assert.rejects(reader.getSnapshot(), (error) => {
    assert.equal(error.code, 'GH_AUTH');
    assert.match(error.message, /Run gh auth login/);
    assert.doesNotMatch(error.message, /private-value|Bad credentials/);
    return true;
  });
});

test('createGitHubReader maps missing Actions write access to a safe permission error', async () => {
  const { spawn } = fakeSpawner(({ args }) => (
    args[0] === 'repo'
      ? { stdout: 'cmuir_pingcorp/AI-DEMO2\n' }
      : { code: 1, stderr: 'HTTP 403 Resource not accessible by integration token=private-value' }
  ));
  const reader = createGitHubReader({ spawn });

  await assert.rejects(reader.performAction({ type: 'run', action: 'cancel', id: 41 }), (error) => {
    assert.equal(error.code, 'GH_PERMISSION');
    assert.match(error.message, /Check repository Actions or Administration permissions/);
    assert.doesNotMatch(error.message, /private-value|integration/);
    return true;
  });
});

test('createGitHubReader rejects malformed API JSON without exposing its payload', async () => {
  const { spawn } = fakeSpawner(({ args }) => (
    args[0] === 'repo'
      ? { stdout: 'cmuir_pingcorp/AI-DEMO2\n' }
      : { stdout: '{ token=private-value' }
  ));
  const reader = createGitHubReader({ spawn });

  await assert.rejects(reader.getSnapshot(), (error) => {
    assert.equal(error.code, 'GH_RESPONSE');
    assert.match(error.message, /unreadable response/);
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
});

test('createGitHubReader paginates the full queued run list', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => run(100 + index, '2026-09-28T10:00:00Z'));
  const finalPage = [run(250, '2026-09-28T11:00:00Z')];
  const { spawn } = fakeSpawner(({ args }) => {
    if (args[0] === 'repo') return { stdout: 'cmuir_pingcorp/AI-DEMO2\n' };
    const endpoint = args[1];
    const page = new URL(`https://local/${endpoint}`).searchParams.get('page');
    if (endpoint.includes('status=queued') && page === '1') return { stdout: JSON.stringify({ workflow_runs: firstPage }) };
    if (endpoint.includes('status=queued') && page === '2') return { stdout: JSON.stringify({ workflow_runs: finalPage }) };
    if (endpoint.includes('status=queued')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (endpoint.includes('status=waiting') || endpoint.includes('status=pending') || endpoint.includes('status=requested')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (endpoint.includes('status=in_progress')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (endpoint.includes('status=completed')) return { stdout: JSON.stringify({ workflow_runs: [] }) };
    if (/\/jobs\?/.test(endpoint)) return { stdout: JSON.stringify({ jobs: [] }) };
    assert.fail(`unexpected gh api endpoint: ${endpoint}`);
  });
  const reader = createGitHubReader({ spawn });

  const snapshot = await reader.getSnapshot();

  assert.equal(snapshot.summary.queued, 101);
  assert.equal(snapshot.runs[0].id, 100);
  assert.equal(snapshot.runs.at(-1).id, 250);
});

test('createGitHubReader returns workflow and runner controls from repository Actions', async () => {
  const { spawn, calls } = fakeSpawner(({ args }) => {
    if (args[0] === 'repo') return { stdout: 'cmuir_pingcorp/AI-DEMO2\n' };
    if (args[1] === 'repos/cmuir_pingcorp/AI-DEMO2/actions/workflows?per_page=100&page=1') {
      return { stdout: JSON.stringify({ workflows: [{ id: 7, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', html_url: 'https://github.com/cmuir_pingcorp/AI-DEMO2/actions/workflows/ci.yml' }] }) };
    }
    if (args[1] === 'repos/cmuir_pingcorp/AI-DEMO2/actions/runners?per_page=100&page=1') {
      return { stdout: JSON.stringify({ runners: [{ id: 23, name: 'cmuir-dev-mac', status: 'online', busy: false, labels: [{ name: 'self-hosted' }, { name: 'macOS' }] }] }) };
    }
    assert.fail(`unexpected gh api endpoint: ${args[1]}`);
  });
  const reader = createGitHubReader({ spawn });

  assert.deepEqual(await reader.getControlState(), {
    repository: 'cmuir_pingcorp/AI-DEMO2',
    workflows: [{ id: 7, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', url: 'https://github.com/cmuir_pingcorp/AI-DEMO2/actions/workflows/ci.yml' }],
    runners: [{ id: 23, name: 'cmuir-dev-mac', status: 'online', busy: false, labels: ['self-hosted', 'macOS'] }],
  });
  assert.ok(calls.every((call) => call.options.shell === false));
});

test('performAction uses fixed GitHub Actions endpoints for run and workflow controls', async () => {
  const { spawn, calls } = fakeSpawner(({ args }) => (
    args[0] === 'repo'
      ? { stdout: 'cmuir_pingcorp/AI-DEMO2\n' }
      : { stdout: '{}' }
  ));
  const reader = createGitHubReader({ spawn });

  await reader.performAction({ type: 'run', action: 'cancel', id: 41 });
  await reader.performAction({ type: 'run', action: 'rerun-failed', id: 42 });
  await reader.performAction({ type: 'workflow', action: 'pause', id: 7 });
  await reader.performAction({ type: 'workflow', action: 'resume', id: 8 });

  assert.deepEqual(calls.filter((call) => call.args[0] === 'api').map((call) => call.args.slice(1)), [
    ['-X', 'POST', 'repos/cmuir_pingcorp/AI-DEMO2/actions/runs/41/cancel'],
    ['-X', 'POST', 'repos/cmuir_pingcorp/AI-DEMO2/actions/runs/42/rerun-failed-jobs'],
    ['-X', 'PUT', 'repos/cmuir_pingcorp/AI-DEMO2/actions/workflows/7/disable'],
    ['-X', 'PUT', 'repos/cmuir_pingcorp/AI-DEMO2/actions/workflows/8/enable'],
  ]);
});

test('performAction rejects unsupported operations before calling GitHub', async () => {
  let calls = 0;
  const { spawn } = fakeSpawner(({ args }) => {
    calls += 1;
    return args[0] === 'repo' ? { stdout: 'cmuir_pingcorp/AI-DEMO2\n' } : { stdout: '{}' };
  });
  const reader = createGitHubReader({ spawn });

  await assert.rejects(reader.performAction({ type: 'runner', action: 'delete', id: 23 }), { code: 'GH_ACTION' });
  assert.equal(calls, 0);
});


test('normalizeJob retains ordered step progress and explicit timing from the existing jobs response', () => {
  const job = normalizeJob({ id: 8, steps: [
    { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', started_at: '2026-09-28T10:01:00Z', completed_at: '2026-09-28T10:02:00Z' },
    { number: 2, name: '<script>Test</script>', status: 'in_progress', conclusion: null, started_at: '2026-09-28T10:02:00Z', completed_at: null },
    { number: 3, name: 'Upload', status: 'pending' },
  ] });
  assert.deepEqual(job.steps, [
    { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', startedAt: '2026-09-28T10:01:00Z', completedAt: '2026-09-28T10:02:00Z' },
    { number: 2, name: '<script>Test</script>', status: 'in_progress', conclusion: null, startedAt: '2026-09-28T10:02:00Z', completedAt: null },
    { number: 3, name: 'Upload', status: 'pending', conclusion: null, startedAt: null, completedAt: null },
  ]);
  assert.deepEqual(normalizeJob({ id: 9 }).steps, []);
});

test('normalizeRun retains an explicit completion separately from the existing update-time fallback', () => {
  const run = normalizeRun({ id: 9, status: 'completed', updated_at: '2026-09-28T10:03:00Z' });
  assert.equal(run.completedAt, '2026-09-28T10:03:00Z');
  assert.equal(run.runCompletedAt, null);
  assert.equal(normalizeRun({ id: 10, run_completed_at: '2026-09-28T10:03:00Z' }).runCompletedAt, '2026-09-28T10:03:00Z');
});

test('getInsights reads runs and pulls once per cache window and fetches jobs only when main is red', async () => {
  let clock = Date.parse('2026-10-01T12:00:00Z');
  const stale = { ...run(41, '2026-10-01T11:50:00Z'), head_branch: 'merged-branch', head_sha: 'aaa' };
  const redMain = { ...run(39, '2026-10-01T11:00:00Z', 'completed', 'failure'), head_branch: 'main', event: 'push', head_sha: 'bbb', display_title: 'Merge pull request #456 from a/b' };
  const { spawn, calls } = fakeSpawner(({ args }) => {
    if (args[0] === 'repo') return { stdout: 'cmuir_pingcorp/AI-DEMO2\n' };
    const endpoint = args[1];
    if (endpoint.includes('/actions/runs?per_page=100&page=1')) return { stdout: JSON.stringify({ workflow_runs: [stale, redMain] }) };
    if (endpoint.includes('/pulls?state=open')) return { stdout: '[]' };
    if (endpoint.includes('/pulls?state=closed')) return { stdout: JSON.stringify([{ number: 457, head: { ref: 'merged-branch' }, merged_at: '2026-10-01T11:30:00Z' }]) };
    if (endpoint.endsWith('/39/jobs?per_page=100&page=1')) return { stdout: JSON.stringify({ jobs: [{ id: 1, name: 'API server tests (Jest)', conclusion: 'failure' }, { id: 2, name: 'Gates', conclusion: 'success' }] }) };
    assert.fail(`unexpected gh api endpoint: ${endpoint}`);
  });
  const reader = createGitHubReader({ spawn, now: () => new Date(clock) });

  const insights = await reader.getInsights();

  assert.deepEqual(insights.staleRuns, [{ id: 41, pr: 457, state: 'merged' }]);
  assert.equal(insights.main.state, 'red');
  assert.equal(insights.main.firstBad.pr, 456);
  assert.deepEqual(insights.main.failedJobs, ['API server tests (Jest)']);
  assert.ok(calls.every((call) => call.command === 'gh' && call.options.shell === false));

  const callsAfterFirst = calls.length;
  await reader.getInsights();
  assert.equal(calls.length, callsAfterFirst, 'a second read inside the cache window makes no GitHub calls');
  clock += 31_000;
  await reader.getInsights();
  assert.ok(calls.length > callsAfterFirst, 'the cache expires');
});
