'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const path = require('node:path');

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15000;

class DashboardDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DashboardDataError';
    this.code = code;
  }
}

function normalizeRun(run) {
  const status = run.status || 'unknown';
  return {
    id: Number(run.id),
    workflow: run.name || run.path || 'Workflow',
    title: run.display_title || run.name || 'Workflow run',
    branch: run.head_branch || '',
    event: run.event || '',
    status,
    conclusion: run.conclusion || null,
    createdAt: run.created_at || null,
    startedAt: run.run_started_at || null,
    updatedAt: run.updated_at || null,
    completedAt: run.run_completed_at || (status === 'completed' ? run.updated_at || null : null),
    url: run.html_url || '',
  };
}

function normalizeJob(job) {
  return {
    id: Number(job.id),
    name: job.name || 'Job',
    status: job.status || 'unknown',
    conclusion: job.conclusion || null,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    runnerName: job.runner_name || null,
    runnerGroup: job.runner_group_name || null,
    labels: Array.isArray(job.labels) ? job.labels.map(String) : [],
  };
}

function byCreatedAtAscending(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id - b.id;
}

function byCreatedAtDescending(a, b) {
  return byCreatedAtAscending(b, a);
}

function buildSnapshot({ repository, queuedRuns = [], runningRuns = [], completedRuns = [], jobsByRun = {}, now = new Date() }) {
  const queued = queuedRuns.map(normalizeRun).sort(byCreatedAtAscending);
  const running = runningRuns.map(normalizeRun).sort(byCreatedAtAscending);
  const completed = completedRuns
    .map(normalizeRun)
    .sort(byCreatedAtDescending)
    .slice(0, 5);
  const seen = new Set();
  const runs = [...queued, ...running, ...completed]
    .filter((run) => {
      if (!Number.isSafeInteger(run.id) || run.id <= 0 || seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    })
    .map((run) => ({ ...run, jobs: jobsByRun[run.id] || [] }));

  const completedCounts = completed.reduce((counts, run) => {
    if (run.conclusion === 'success') counts.succeeded += 1;
    else counts.failed += 1;
    return counts;
  }, { succeeded: 0, failed: 0 });

  return {
    repository,
    updatedAt: now.toISOString(),
    summary: {
      queued: queued.length,
      inProgress: running.length,
      ...completedCounts,
    },
    runs,
  };
}

function validateRepositorySlug(value) {
  const slug = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) {
    throw new DashboardDataError('GH_REPOSITORY', 'The current checkout is not a GitHub repository.');
  }
  return slug;
}

function validateRunId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DashboardDataError('GH_RUN_ID', 'GitHub returned an invalid workflow run identifier.');
  }
  return id;
}

function runGh(spawn, args, { cwd, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('gh', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(mapSpawnError(error));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let oversized = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const stopForLimit = () => {
      oversized = true;
      child.kill('SIGTERM');
    };

    const collect = (target) => (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += data.length;
      if (outputBytes > maxOutputBytes) {
        if (!oversized) stopForLimit();
        return;
      }
      if (target === 'stdout') stdout += data.toString('utf8');
      else stderr += data.toString('utf8');
    };

    child.stdout?.on('data', collect('stdout'));
    child.stderr?.on('data', collect('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    timer.unref?.();

    child.once('error', (error) => finish(mapSpawnError(error)));
    child.once('close', (code) => {
      if (oversized) return finish(new DashboardDataError('GH_OUTPUT_LIMIT', 'GitHub returned more dashboard data than expected.'));
      if (timedOut) return finish(new DashboardDataError('GH_TIMEOUT', 'GitHub did not respond in time.'));
      if (code !== 0) {
        const authError = /not logged in|authentication required|must authenticate|bad credentials/i.test(stderr);
        return finish(new DashboardDataError(
          authError ? 'GH_AUTH' : 'GH_API',
          authError ? 'GitHub CLI authentication is unavailable. Run gh auth login.' : 'GitHub Actions data could not be loaded. Check GitHub access and try again.',
        ));
      }
      finish(null, stdout);
    });
  });
}

function mapSpawnError(error) {
  if (error?.code === 'ENOENT') {
    return new DashboardDataError('GH_MISSING', 'GitHub CLI was not found. Install gh and run gh auth login.');
  }
  return new DashboardDataError('GH_PROCESS', 'GitHub CLI could not be started.');
}

function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unreadable response.');
  }
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

function createGitHubReader({
  repoRoot = path.resolve(__dirname, '../..'),
  spawn = nodeSpawn,
  now = () => new Date(),
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxOutputBytes = MAX_OUTPUT_BYTES,
} = {}) {
  let repositoryPromise;
  const completedJobsCache = new Map();

  const callGh = (args) => runGh(spawn, args, { cwd: repoRoot, timeoutMs, maxOutputBytes });

  async function getRepository() {
    if (!repositoryPromise) {
      repositoryPromise = callGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
        .then(validateRepositorySlug);
    }
    return repositoryPromise;
  }

  async function readRuns(repository, status, page) {
    const endpoint = `repos/${repository}/actions/runs?status=${status}&per_page=${PAGE_SIZE}&page=${page}`;
    const response = parseJson(await callGh(['api', endpoint]));
    if (!Array.isArray(response.workflow_runs)) {
      throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unexpected workflow runs response.');
    }
    return response.workflow_runs;
  }

  async function readAllRuns(repository, status) {
    const runs = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const current = await readRuns(repository, status, page);
      runs.push(...current);
      if (current.length < PAGE_SIZE) return runs;
    }
    throw new DashboardDataError('GH_RUN_LIMIT', 'The active workflow queue is larger than the dashboard limit.');
  }

  async function readCompletedRuns(repository) {
    const endpoint = `repos/${repository}/actions/runs?status=completed&per_page=5&page=1`;
    const response = parseJson(await callGh(['api', endpoint]));
    if (!Array.isArray(response.workflow_runs)) {
      throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unexpected workflow runs response.');
    }
    return response.workflow_runs;
  }

  async function readJobs(repository, runId) {
    const jobs = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const endpoint = `repos/${repository}/actions/runs/${validateRunId(runId)}/jobs?per_page=${PAGE_SIZE}&page=${page}`;
      const response = parseJson(await callGh(['api', endpoint]));
      if (!Array.isArray(response.jobs)) {
        throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unexpected workflow jobs response.');
      }
      jobs.push(...response.jobs.map(normalizeJob));
      if (response.jobs.length < PAGE_SIZE) return jobs;
    }
    throw new DashboardDataError('GH_JOB_LIMIT', 'A workflow has more jobs than the dashboard limit.');
  }

  async function getSnapshot() {
    const repository = await getRepository();
    const [queuedRuns, runningRuns, completedRuns] = await Promise.all([
      readAllRuns(repository, 'queued'),
      readAllRuns(repository, 'in_progress'),
      readCompletedRuns(repository),
    ]);
    const selectedCompletedRuns = completedRuns.slice(0, 5);
    const allRuns = [...queuedRuns, ...runningRuns, ...selectedCompletedRuns];
    const activeIds = new Set([...queuedRuns, ...runningRuns].map((run) => Number(run.id)));
    const liveCompletedIds = new Set(selectedCompletedRuns.map((run) => Number(run.id)));
    const jobsList = await mapLimit(allRuns, 5, async (run) => {
      const runId = validateRunId(run.id);
      if (activeIds.has(runId)) return [runId, await readJobs(repository, runId)];
      if (completedJobsCache.has(runId)) return [runId, completedJobsCache.get(runId)];
      const jobs = await readJobs(repository, runId);
      completedJobsCache.set(runId, jobs);
      return [runId, jobs];
    });
    for (const cachedId of completedJobsCache.keys()) {
      if (!liveCompletedIds.has(cachedId)) completedJobsCache.delete(cachedId);
    }

    return buildSnapshot({
      repository,
      queuedRuns,
      runningRuns,
      completedRuns: selectedCompletedRuns,
      jobsByRun: Object.fromEntries(jobsList),
      now: now(),
    });
  }

  return { getSnapshot };
}

module.exports = {
  DashboardDataError,
  buildSnapshot,
  createGitHubReader,
  normalizeJob,
  normalizeRun,
  validateRepositorySlug,
  validateRunId,
};
