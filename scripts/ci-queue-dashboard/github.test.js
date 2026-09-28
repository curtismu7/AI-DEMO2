'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { DashboardDataError, buildSnapshot, createGitHubReader, normalizeJob, normalizeRun } = require('./github');

function run(id, createdAt, status = 'queued', conclusion = null) {
  return {
    id,
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
