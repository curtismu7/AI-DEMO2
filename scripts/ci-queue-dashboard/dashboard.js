'use strict';

const POLL_INTERVAL_MS = 15000;
let refreshInProgress = false;
let currentSnapshot = null;

const elements = {
  repository: document.getElementById('repository-name'),
  freshness: document.getElementById('freshness'),
  liveState: document.getElementById('live-state'),
  error: document.getElementById('error-banner'),
  refresh: document.getElementById('refresh-button'),
  queuedTotal: document.getElementById('summary-queued'),
  runningTotal: document.getElementById('summary-running'),
  passedTotal: document.getElementById('summary-passed'),
  failedTotal: document.getElementById('summary-failed'),
  runnerCount: document.getElementById('runner-count'),
  runnerContent: document.getElementById('runner-content'),
  activeCount: document.getElementById('active-count'),
  activeEmpty: document.getElementById('active-empty'),
  activeRuns: document.getElementById('active-runs'),
  queueCount: document.getElementById('queue-count'),
  queueEmpty: document.getElementById('queue-empty'),
  queuedRuns: document.getElementById('queued-runs'),
  completedEmpty: document.getElementById('completed-empty'),
  completedRuns: document.getElementById('completed-runs'),
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function statusLabel(status, conclusion) {
  const result = normalized(conclusion);
  const state = normalized(status);
  if (result === 'success') return 'Passed';
  if (result === 'failure' || result === 'timed_out' || result === 'action_required') return 'Failed';
  if (result === 'cancelled') return 'Cancelled';
  if (result === 'skipped' || result === 'neutral') return 'Skipped';
  if (state === 'queued' || state === 'requested' || state === 'waiting' || state === 'pending') return 'Queued';
  if (state === 'in_progress') return 'Running';
  if (state === 'completed') return 'Completed';
  return 'Status unavailable';
}

function statusClass(status, conclusion) {
  const result = normalized(conclusion);
  const state = normalized(status);
  if (result === 'success') return 'status--passed';
  if (result === 'failure' || result === 'timed_out' || result === 'action_required') return 'status--failed';
  if (result === 'cancelled') return 'status--cancelled';
  if (result === 'skipped' || result === 'neutral') return 'status--skipped';
  if (state === 'queued' || state === 'requested' || state === 'waiting' || state === 'pending') return 'status--queued';
  if (state === 'in_progress') return 'status--running';
  return 'status--neutral';
}

function formatDuration(startValue, endValue = null) {
  if (!startValue) return 'Time unavailable';
  const start = Date.parse(startValue);
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Time unavailable';
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatLocalTime(value) {
  if (!value) return 'Not started';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
}

function safeGitHubUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'github.com') return url.href;
  } catch {}
  return null;
}

function makeStatus(status, conclusion) {
  return node('span', `status-badge ${statusClass(status, conclusion)}`, statusLabel(status, conclusion));
}

function runTiming(run) {
  const timingKind = window.CiQueueDashboardModel.runTimingKind(run.status);
  if (timingKind === 'waiting') return `Waiting ${formatDuration(run.createdAt)}`;
  if (timingKind === 'running') return `Running ${formatDuration(run.startedAt || run.createdAt)}`;
  return `Finished ${formatLocalTime(run.completedAt || run.updatedAt)}`;
}

function jobTiming(job, run) {
  if (normalized(job.status) === 'queued' || normalized(job.status) === 'waiting' || normalized(job.status) === 'pending') {
    return `Waiting ${formatDuration(job.startedAt || run.createdAt)}`;
  }
  if (normalized(job.status) === 'in_progress') return `Running ${formatDuration(job.startedAt || run.startedAt || run.createdAt)}`;
  return formatDuration(job.startedAt, job.completedAt);
}

function addJobTable(run, compact = false) {
  const wrapper = node('div', compact ? 'job-table-wrap job-table-wrap--compact' : 'job-table-wrap');
  const table = node('table', 'job-table');
  const head = node('thead');
  const headRow = node('tr');
  for (const label of ['Job', 'Status', 'Time', 'Runner']) headRow.append(node('th', '', label));
  head.append(headRow);
  table.append(head);

  const body = node('tbody');
  for (const job of Array.isArray(run.jobs) ? run.jobs : []) {
    const row = node('tr', 'job-row');
    const name = node('th', 'job-name', job.name || 'Job');
    name.scope = 'row';
    const status = node('td');
    status.append(makeStatus(job.status, job.conclusion));
    const timing = node('td', 'job-timing', jobTiming(job, run));
    const runner = node('td', 'job-runner');
    const runnerInfo = window.CiQueueDashboardModel.runnerDetails(job);
    runner.append(node('span', `runner-${runnerInfo.state}`, runnerInfo.name));
    for (const detail of runnerInfo.details) runner.append(node('span', 'runner-labels', detail));
    row.append(name, status, timing, runner);
    body.append(row);
  }
  table.append(body);
  wrapper.append(table);

  if (!Array.isArray(run.jobs) || run.jobs.length === 0) {
    wrapper.append(node('p', 'job-unavailable', 'Job details are not available yet.'));
  }
  return wrapper;
}

function createRunArticle(run, compact = false) {
  const article = node('article', `run-entry${compact ? ' run-entry--completed' : ''}`);
  article.dataset.status = statusClass(run.status, run.conclusion).replace('status--', '');
  const header = node('div', 'run-entry-header');
  const titleGroup = node('div', 'run-title-group');
  const title = node('h3', 'run-title', run.title || run.workflow || 'Workflow run');
  const workflow = node('p', 'run-workflow', run.workflow || 'Workflow');
  titleGroup.append(title, workflow);
  const linkUrl = safeGitHubUrl(run.url);
  if (linkUrl) {
    const link = node('a', 'run-link', 'Open run');
    link.href = linkUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    titleGroup.append(link);
  }
  header.append(titleGroup, makeStatus(run.status, run.conclusion));

  const metadata = node('div', 'run-metadata');
  metadata.append(node('span', 'run-branch', run.branch || 'Branch unavailable'));
  metadata.append(node('span', 'run-event', String(run.event || 'Event unavailable').replaceAll('_', ' ')));
  metadata.append(node('span', 'run-timing', runTiming(run)));

  article.append(header, metadata, addJobTable(run, compact));
  return article;
}

function renderRunner(snapshot) {
  const assigned = [];
  let runningCount = 0;
  for (const run of snapshot.runs.filter((item) => normalized(item.status) === 'in_progress')) {
    for (const job of Array.isArray(run.jobs) ? run.jobs : []) {
      if (normalized(job.status) !== 'in_progress') continue;
      runningCount += 1;
      if (job.runnerName) assigned.push({ run, job });
    }
  }
  elements.runnerContent.replaceChildren();
  elements.runnerCount.textContent = assigned.length ? `${assigned.length} assigned` : runningCount ? 'Assignment pending' : 'Idle';

  if (assigned.length === 0) {
    const message = runningCount
      ? 'A job is running, but GitHub has not reported its runner name yet.'
      : 'No job is currently assigned to a runner.';
    const row = node('div', `runner-idle${runningCount ? ' runner-idle--unknown' : ''}`);
    row.append(node('span', 'runner-state-mark'));
    row.append(node('p', 'runner-idle-copy', message));
    elements.runnerContent.append(row);
    return;
  }

  for (const { run, job } of assigned) {
    const row = node('div', 'runner-assignment');
    const runner = node('div', 'runner-machine');
    runner.append(node('span', 'runner-state-mark runner-state-mark--active'));
    const runnerText = node('div', 'runner-machine-text');
    runnerText.append(node('strong', 'runner-name', job.runnerName));
    if (job.runnerGroup) runnerText.append(node('span', 'runner-group', `Group: ${job.runnerGroup}`));
    if (job.labels?.length) runnerText.append(node('span', 'runner-group', `Labels: ${job.labels.join(', ')}`));
    runner.append(runnerText);
    const work = node('div', 'runner-work');
    work.append(node('span', 'runner-job-name', job.name));
    work.append(node('span', 'runner-workflow-name', `${run.workflow || 'Workflow'} / ${run.branch || 'branch unavailable'}`));
    row.append(runner, work, node('span', 'runner-duration', jobTiming(job, run)));
    elements.runnerContent.append(row);
  }
}

function render(snapshot) {
  currentSnapshot = snapshot;
  elements.repository.textContent = snapshot.repository || 'GitHub repository';
  elements.freshness.textContent = `Updated ${formatLocalTime(snapshot.updatedAt)}`;
  elements.liveState.replaceChildren(node('span', 'live-indicator'), node('span', '', 'Live queue'));
  elements.error.hidden = true;

  const summary = snapshot.summary || {};
  elements.queuedTotal.textContent = String(summary.queued ?? 0);
  elements.runningTotal.textContent = String(summary.inProgress ?? 0);
  elements.passedTotal.textContent = String(summary.succeeded ?? 0);
  elements.failedTotal.textContent = String(summary.failed ?? 0);

  const groups = window.CiQueueDashboardModel.classifyRuns(snapshot.runs);
  elements.activeCount.textContent = `${groups.inProgress.length} running`;
  elements.activeEmpty.hidden = groups.inProgress.length > 0;
  elements.activeRuns.replaceChildren(...groups.inProgress.map((run) => createRunArticle(run)));
  elements.queueCount.textContent = `${groups.queued.length} waiting`;
  elements.queueEmpty.hidden = groups.queued.length > 0;
  elements.queuedRuns.replaceChildren(...groups.queued.map((run) => createRunArticle(run)));
  elements.completedEmpty.hidden = groups.completed.length > 0;
  elements.completedRuns.replaceChildren(...groups.completed.map((run) => createRunArticle(run, true)));
  renderRunner(snapshot);
}

function showRefreshError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.liveState.replaceChildren(node('span', 'live-indicator live-indicator--stale'), node('span', '', currentSnapshot ? 'Showing last update' : 'Waiting for GitHub'));
  if (currentSnapshot) elements.freshness.textContent = `Last successful update ${formatLocalTime(currentSnapshot.updatedAt)}`;
  else elements.freshness.textContent = 'No queue update received';
}

async function refresh() {
  if (refreshInProgress || document.visibilityState === 'hidden') return;
  refreshInProgress = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = 'Refreshing';
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store', headers: { Accept: 'application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || 'GitHub Actions data could not be loaded.');
    render(body);
  } catch (error) {
    showRefreshError(error instanceof Error ? error.message : 'GitHub Actions data could not be loaded.');
  } finally {
    refreshInProgress = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = 'Refresh now';
  }
}

elements.refresh.addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
window.setInterval(refresh, POLL_INTERVAL_MS);
refresh();
