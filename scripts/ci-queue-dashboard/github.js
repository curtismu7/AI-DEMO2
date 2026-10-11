'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const path = require('node:path');
const { imageBuilds } = require('./deploy-state');
const { duplicateRuns, failedJobNames, mainHealth, staleRuns, turnaroundTrend } = require('./insights');

const INSIGHTS_TTL_MS = 30_000;
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
    workflowId: Number.isSafeInteger(Number(run.workflow_id)) ? Number(run.workflow_id) : null,
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
    runCompletedAt: run.run_completed_at || null,
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
    steps: Array.isArray(job.steps) ? job.steps.map((step) => ({
      number: step.number ?? null,
      name: step.name || 'Step',
      status: step.status || 'unknown',
      conclusion: step.conclusion || null,
      startedAt: step.started_at || null,
      completedAt: step.completed_at || null,
    })) : [],
  };
}

function normalizeWorkflow(workflow) {
  return {
    id: Number(workflow.id),
    name: workflow.name || workflow.path || 'Workflow',
    path: workflow.path || '',
    state: workflow.state || 'unknown',
    url: workflow.html_url || '',
  };
}

function normalizeRunner(runner) {
  return {
    id: Number(runner.id),
    name: runner.name || 'Runner',
    status: runner.status || 'unknown',
    busy: Boolean(runner.busy),
    labels: Array.isArray(runner.labels) ? runner.labels.map((label) => String(label.name || '')).filter(Boolean) : [],
  };
}

function byCreatedAtAscending(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id - b.id;
}

function byCreatedAtDescending(a, b) {
  return byCreatedAtAscending(b, a);
}

function normalizedRuns(runs) {
  const seen = new Set();
  return runs.map(normalizeRun).filter((run) => {
    if (!Number.isSafeInteger(run.id) || run.id <= 0 || seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
}

function buildSnapshot({ repository, queuedRuns = [], runningRuns = [], completedRuns = [], jobsByRun = {}, now = new Date() }) {
  const queued = normalizedRuns(queuedRuns).sort(byCreatedAtAscending);
  const running = normalizedRuns(runningRuns).sort(byCreatedAtAscending);
  const completed = normalizedRuns(completedRuns).sort(byCreatedAtDescending);
  const completedWindow = completed.slice(0, 100);
  const displayedCompleted = completedWindow.slice(0, 5);
  const seen = new Set();
  const runs = [...queued, ...running, ...displayedCompleted]
    .filter((run) => {
      if (!Number.isSafeInteger(run.id) || run.id <= 0 || seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    })
    .map((run) => {
      const jobs = jobsByRun[run.id] || [];
      // GitHub keeps a run "queued" while any of its jobs still waits for a
      // runner, even when another job is already executing.
      const executing = run.status !== 'completed' && jobs.some((job) => job.status === 'in_progress');
      return { ...run, status: executing ? 'in_progress' : run.status, jobs };
    });
  const promoted = runs.filter((run) => run.status === 'in_progress').length - running.length;

  const completedCounts = completedWindow.reduce((counts, run) => {
    if (run.conclusion === 'success') counts.succeeded += 1;
    else if (['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)) counts.failed += 1;
    return counts;
  }, { succeeded: 0, failed: 0 });

  return {
    repository,
    updatedAt: now.toISOString(),
    summary: {
      queued: queued.length - promoted,
      inProgress: running.length + promoted,
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
        const authError = /not logged in|authentication required|must authenticate|bad credentials|gh auth login/i.test(stderr);
        const permissionError = /resource not accessible|must have .* permission|requires .* permission|HTTP 403/i.test(stderr);
        return finish(new DashboardDataError(
          authError ? 'GH_AUTH' : permissionError ? 'GH_PERMISSION' : 'GH_API',
          authError ? 'GitHub CLI authentication is unavailable. Run gh auth login.' : permissionError ? 'GitHub denied this Actions operation. Check repository Actions or Administration permissions.' : 'GitHub Actions data could not be loaded. Check GitHub access and try again.',
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
    // One page of recent history: the summary counts over this whole window,
    // while the display keeps only the five newest cards.
    const endpoint = `repos/${repository}/actions/runs?status=completed&per_page=${PAGE_SIZE}&page=1`;
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

  async function readControlList(repository, collection, endpointPath) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = parseJson(await callGh(['api', `repos/${repository}/actions/${endpointPath}?per_page=${PAGE_SIZE}&page=${page}`]));
      if (!Array.isArray(response[collection])) {
        throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unexpected Actions control response.');
      }
      items.push(...response[collection]);
      if (response[collection].length < PAGE_SIZE) return items;
    }
    throw new DashboardDataError('GH_CONTROL_LIMIT', 'GitHub returned more Actions controls than the dashboard limit.');
  }

  async function getControlState() {
    const repository = await getRepository();
    const [workflows, runners] = await Promise.all([
      readControlList(repository, 'workflows', 'workflows'),
      readControlList(repository, 'runners', 'runners'),
    ]);
    return {
      repository,
      workflows: workflows.map(normalizeWorkflow).filter((workflow) => Number.isSafeInteger(workflow.id) && workflow.id > 0),
      runners: runners.map(normalizeRunner).filter((runner) => Number.isSafeInteger(runner.id) && runner.id > 0),
    };
  }

  async function performAction({ type, action, id }) {
    const resourceId = validateRunId(id);
    const operations = {
      'run:cancel': ['POST', `actions/runs/${resourceId}/cancel`],
      'run:rerun-failed': ['POST', `actions/runs/${resourceId}/rerun-failed-jobs`],
      'workflow:pause': ['PUT', `actions/workflows/${resourceId}/disable`],
      'workflow:resume': ['PUT', `actions/workflows/${resourceId}/enable`],
    };
    const operation = operations[`${type}:${action}`];
    if (!operation) throw new DashboardDataError('GH_ACTION', 'This dashboard action is not supported.');
    const repository = await getRepository();
    await callGh(['api', '-X', operation[0], `repos/${repository}/${operation[1]}`]);
    return { ok: true };
  }

  async function getSnapshot() {
    const repository = await getRepository();
    const [queuedRuns, waitingRuns, pendingRuns, requestedRuns, runningRuns, completedRuns] = await Promise.all([
      readAllRuns(repository, 'queued'),
      readAllRuns(repository, 'waiting'),
      readAllRuns(repository, 'pending'),
      readAllRuns(repository, 'requested'),
      readAllRuns(repository, 'in_progress'),
      readCompletedRuns(repository),
    ]);
    const allQueuedRuns = [...queuedRuns, ...waitingRuns, ...pendingRuns, ...requestedRuns];
    const selectedCompletedRuns = completedRuns.slice(0, 5);
    const allRuns = [...allQueuedRuns, ...runningRuns, ...selectedCompletedRuns];
    const activeIds = new Set([...allQueuedRuns, ...runningRuns].map((run) => Number(run.id)));
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
      queuedRuns: allQueuedRuns,
      runningRuns,
      // Summary counts span the whole fetched window; jobs load only for the
      // five newest completed runs shown as cards.
      completedRuns,
      jobsByRun: Object.fromEntries(jobsList),
      now: now(),
    });
  }

  let insightsCache = null;

  // Queue insights (stale and duplicate runs, default-branch health,
  // turnaround trend). Separate from getSnapshot so a failure here never blanks the queue.
  // ponytail: reads only the newest 100 runs, so an active run older than that
  // is not flagged; page further if the queue ever gets that deep.
  async function getInsights() {
    const current = now().getTime();
    if (insightsCache && current - insightsCache.at < INSIGHTS_TTL_MS) return insightsCache.value;
    const repository = await getRepository();
    const [runsResponse, openPulls, closedPulls] = await Promise.all([
      callGh(['api', `repos/${repository}/actions/runs?per_page=${PAGE_SIZE}&page=1`]).then(parseJson),
      callGh(['api', `repos/${repository}/pulls?state=open&per_page=${PAGE_SIZE}`]).then(parseJson),
      callGh(['api', `repos/${repository}/pulls?state=closed&sort=updated&direction=desc&per_page=50`]).then(parseJson),
    ]);
    if (!Array.isArray(runsResponse.workflow_runs) || !Array.isArray(openPulls) || !Array.isArray(closedPulls)) {
      throw new DashboardDataError('GH_RESPONSE', 'GitHub returned an unexpected insights response.');
    }
    const runs = runsResponse.workflow_runs;
    const main = mainHealth(runs);
    if (main.state === 'red') main.failedJobs = failedJobNames(await readJobs(repository, main.latest.id));
    const value = {
      staleRuns: staleRuns(runs, openPulls, closedPulls),
      duplicateRuns: duplicateRuns(runs),
      main,
      turnaroundTrend: turnaroundTrend(runs),
      imageBuilds: imageBuilds(runs),
    };
    insightsCache = { at: current, value };
    return value;
  }

  return { getSnapshot, getControlState, getInsights, performAction };
}

module.exports = {
  DashboardDataError,
  buildSnapshot,
  createGitHubReader,
  normalizeJob,
  normalizeRun,
  normalizeRunner,
  normalizeWorkflow,
  validateRepositorySlug,
  validateRunId,
};
