'use strict';

const POLL_INTERVAL_MS = 15000;
let refreshInProgress = false;
let currentSnapshot = null;
let selectedRunId = null;
let detailTrigger = null;

const elements = {
  detailPanel: document.getElementById('run-detail-panel'),
  detailTitle: document.getElementById('run-detail-title'),
  detailContent: document.getElementById('run-detail-content'),
  detailClose: document.getElementById('run-detail-close'),
  queueView: document.getElementById('queue-view'),
  repository: document.getElementById('repository-name'),
  freshness: document.getElementById('freshness'),
  liveState: document.getElementById('live-state'),
  error: document.getElementById('error-banner'),
  actionFeedback: document.getElementById('action-feedback'),
  refresh: document.getElementById('refresh-button'),
  queuedTotal: document.getElementById('summary-queued'),
  runningTotal: document.getElementById('summary-running'),
  passedTotal: document.getElementById('summary-passed'),
  failedTotal: document.getElementById('summary-failed'),
  runnerCount: document.getElementById('runner-count'),
  runnerContent: document.getElementById('runner-content'),
  workflowControls: document.getElementById('workflow-controls'),
  workflowControlNote: document.getElementById('workflow-control-note'),
  runnerControls: document.getElementById('runner-controls'),
  runnerControlNote: document.getElementById('runner-control-note'),
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

function makeActionButton(type, action, id, label, danger = false) {
  const button = node('button', `control-button${danger ? ' control-button--danger' : ''}`, label);
  button.type = 'button';
  button.dataset.actionType = type;
  button.dataset.action = action;
  button.dataset.resourceId = String(id);
  return button;
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

function estimatedRemaining(run, history) {
  const remainingMs = window.CiQueueDashboardModel.estimateRemainingMs(run, history);
  if (remainingMs === null) return 'Estimate unavailable';
  if (remainingMs === 0) return 'At typical runtime';
  const seconds = Math.ceil(Math.abs(remainingMs) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const duration = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${seconds}s`;
  return remainingMs < 0 ? `Over typical runtime by ${duration}` : `Estimated ${duration} left`;
}

function createRunArticle(run, compact = false, history = []) {
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
  const headerActions = node('div', 'run-actions');
  headerActions.append(makeStatus(run.status, run.conclusion));
  const details = node('button', 'control-button', 'Run details');
  details.type = 'button';
  details.dataset.detailRunId = String(run.id);
  details.setAttribute('aria-controls', 'run-detail-panel');
  details.setAttribute('aria-expanded', String(selectedRunId === run.id));
  headerActions.append(details);
  if (selectedRunId === run.id) detailTrigger = details;
  if (['queued', 'requested', 'waiting', 'pending', 'in_progress'].includes(normalized(run.status))) {
    headerActions.append(makeActionButton('run', 'cancel', run.id, 'Stop run', true));
  } else if (run.status === 'completed' && ['failure', 'timed_out', 'action_required'].includes(run.conclusion)) {
    headerActions.append(makeActionButton('run', 'rerun-failed', run.id, 'Rerun failed jobs'));
  }
  header.append(titleGroup, headerActions);

  const metadata = node('div', 'run-metadata');
  metadata.append(node('span', 'run-branch', run.branch || 'Branch unavailable'));
  metadata.append(node('span', 'run-event', String(run.event || 'Event unavailable').replaceAll('_', ' ')));
  metadata.append(node('span', 'run-timing', runTiming(run)));
  if (normalized(run.status) === 'in_progress') metadata.append(node('span', 'run-eta', estimatedRemaining(run, history)));

  article.append(header, metadata, addJobTable(run, compact));
  return article;
}

function formatElapsed(durationMs) {
  if (durationMs === null) return 'Time unavailable';
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function renderRunDetails() {
  const run = currentSnapshot?.runs.find((item) => item.id === selectedRunId);
  elements.detailContent.replaceChildren();
  if (!run) {
    elements.detailTitle.textContent = 'Run details';
    elements.detailContent.append(node('p', 'job-unavailable', 'This run is unavailable in the latest queue update.'));
    return;
  }
  const nowMs = Date.now();
  const model = window.CiQueueDashboardModel;
  const durations = model.runDurations(run, nowMs);
  elements.detailTitle.textContent = `Run details: ${run.title || run.workflow || 'Workflow run'}`;
  elements.detailContent.append(makeStatus(run.status, run.conclusion));
  const timing = node('div', 'detail-timing');
  timing.append(node('p', '', `Queue wait: ${formatElapsed(durations.queueWaitMs)}`));
  timing.append(node('p', '', `Execution duration: ${formatElapsed(durations.executionMs)}`));
  elements.detailContent.append(timing);
  if (!Array.isArray(run.jobs) || !run.jobs.length) {
    elements.detailContent.append(node('p', 'job-unavailable', 'Job details are unavailable.'));
    return;
  }
  for (const job of run.jobs) {
    const section = node('section', 'detail-job');
    const heading = node('div', 'detail-job-heading');
    heading.append(node('h3', '', job.name || 'Job'), makeStatus(job.status, job.conclusion));
    heading.append(node('span', 'job-timing', `Elapsed: ${formatElapsed(model.executionDurationMs(job, nowMs))}`));
    section.append(heading);
    if (!Array.isArray(job.steps) || !job.steps.length) {
      section.append(node('p', 'job-unavailable', 'Step details are unavailable.'));
    } else {
      const steps = node('ol', 'detail-steps');
      for (const step of job.steps) {
        const current = normalized(step.status) === 'in_progress';
        const row = node('li', `detail-step${current ? ' detail-step--current' : ''}`);
        if (current) row.setAttribute('aria-current', 'step');
        row.append(node('span', 'detail-step-name', step.name || 'Step'), makeStatus(step.status, step.conclusion));
        if (current) row.append(node('strong', 'detail-current', 'Current step'));
        row.append(node('span', 'job-timing', `Elapsed: ${formatElapsed(model.executionDurationMs(step, nowMs))}`));
        steps.append(row);
      }
      section.append(steps);
    }
    elements.detailContent.append(section);
  }
}

function openRunDetails(button) {
  selectedRunId = Number(button.dataset.detailRunId);
  detailTrigger = button;
  button.setAttribute('aria-expanded', 'true');
  renderRunDetails();
  elements.queueView.hidden = true;
  elements.detailPanel.hidden = false;
  elements.detailTitle.focus();
}

function closeRunDetails() {
  selectedRunId = null;
  elements.detailPanel.hidden = true;
  elements.queueView.hidden = false;
  detailTrigger?.setAttribute('aria-expanded', 'false');
  (detailTrigger || elements.refresh).focus();
}

function renderWorkflowControls(controls) {
  elements.workflowControls.replaceChildren();
  elements.workflowControlNote.textContent = controls?.error || '';
  const workflows = Array.isArray(controls?.workflows) ? controls.workflows : [];
  if (controls?.error) return;
  if (!workflows.length) {
    elements.workflowControls.append(node('p', 'placeholder', 'No workflows are available.'));
    return;
  }
  for (const workflow of workflows) {
    const row = node('div', 'control-row');
    const identity = node('div', 'control-identity');
    identity.append(node('span', 'control-name', workflow.name));
    const active = workflow.state === 'active';
    identity.append(node('span', `control-state ${active ? 'control-state--active' : 'control-state--disabled'}`, active ? 'Active' : `Disabled (${workflow.state.replaceAll('_', ' ')})`));
    row.append(identity, makeActionButton('workflow', active ? 'pause' : 'resume', workflow.id, active ? 'Pause workflow' : 'Resume workflow'));
    elements.workflowControls.append(row);
  }
}

function renderRunnerControls(controls) {
  elements.runnerControls.replaceChildren();
  elements.runnerControlNote.textContent = controls?.error || '';
  const runners = Array.isArray(controls?.runners) ? controls.runners : [];
  if (controls?.error) return;
  if (!runners.length) {
    elements.runnerControls.append(node('p', 'placeholder', 'No repository runners are available.'));
    return;
  }
  let hasLocalControl = false;
  for (const runner of runners) {
    const row = node('div', 'control-row');
    const identity = node('div', 'control-identity');
    identity.append(node('span', 'control-name', runner.name));
    const localPaused = Boolean(runner.localPaused);
    const busy = Boolean(runner.busy);
    const stateText = localPaused ? 'Paused on this machine' : `${runner.status} · ${busy ? 'Busy' : 'Idle'}`;
    identity.append(node('span', `control-state${runner.status === 'online' && !busy && !localPaused ? ' control-state--active' : ''}`, stateText));
    row.append(identity);
    if (runner.localControlAvailable) {
      hasLocalControl = true;
      const action = localPaused ? 'resume' : 'pause';
      const button = makeActionButton('runner', action, runner.id, localPaused ? 'Resume runner' : 'Pause runner');
      button.disabled = action === 'pause' && (busy || runner.status !== 'online');
      if (button.disabled) button.title = busy ? 'Wait for the assigned job to finish.' : 'This runner must be online to pause.';
      row.append(button);
    } else {
      row.append(node('span', 'control-state', 'No matching local service'));
    }
    elements.runnerControls.append(row);
  }
  if (!hasLocalControl) elements.runnerControlNote.textContent = 'Runner controls appear on the Mac that hosts the matching launchd service.';
}

function renderControls(controls) {
  renderWorkflowControls(controls);
  renderRunnerControls(controls);
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

function render(snapshot, controls) {
  currentSnapshot = snapshot;
  if (selectedRunId !== null) detailTrigger = null;
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
  const jobCount = (runs, statuses) => runs.reduce((total, run) => total + (Array.isArray(run.jobs) ? run.jobs.filter((job) => statuses.includes(normalized(job.status))).length : 0), 0);
  elements.activeCount.textContent = `${groups.inProgress.length} workflows · ${jobCount(groups.inProgress, ['in_progress'])} jobs`;
  elements.activeEmpty.hidden = groups.inProgress.length > 0;
  elements.activeRuns.replaceChildren(...groups.inProgress.map((run) => createRunArticle(run, false, snapshot.runs)));
  elements.queueCount.textContent = `${groups.queued.length} workflows · ${jobCount(groups.queued, ['queued', 'requested', 'waiting', 'pending'])} jobs`;
  elements.queueEmpty.hidden = groups.queued.length > 0;
  elements.queuedRuns.replaceChildren(...groups.queued.map((run) => createRunArticle(run, false, snapshot.runs)));
  elements.completedEmpty.hidden = groups.completed.length > 0;
  elements.completedRuns.replaceChildren(...groups.completed.map((run) => createRunArticle(run, true, snapshot.runs)));
  renderRunner(snapshot);
  renderControls(controls);
  if (selectedRunId !== null) renderRunDetails();
}

function actionPrompt(button) {
  const action = button.dataset.action;
  const type = button.dataset.actionType;
  const id = button.dataset.resourceId;
  if (type === 'run' && action === 'cancel') return `Stop workflow run ${id}? This cancels its queued or running jobs.`;
  if (type === 'run') return `Rerun the failed jobs for workflow run ${id}?`;
  if (type === 'workflow' && action === 'pause') return 'Pause this workflow? New runs will not start until you resume it.';
  if (type === 'workflow') return 'Resume this workflow so new runs can start?';
  if (type === 'runner' && action === 'pause') return 'Pause this local runner? It will stop accepting new jobs after it is stopped.';
  return 'Resume this local runner so it can accept jobs?';
}

function actionDescription(button) {
  const type = button.dataset.actionType;
  const action = button.dataset.action;
  if (type === 'run' && action === 'cancel') return 'Stop request sent to GitHub.';
  if (type === 'run') return 'Rerun request sent to GitHub.';
  if (type === 'workflow' && action === 'pause') return 'Workflow paused.';
  if (type === 'workflow') return 'Workflow resumed.';
  if (type === 'runner' && action === 'pause') return 'Local runner paused.';
  return 'Local runner resumed.';
}

function setActionFeedback(message, isError = false) {
  elements.actionFeedback.hidden = !message;
  elements.actionFeedback.dataset.kind = isError ? 'error' : 'success';
  elements.actionFeedback.textContent = message;
}

async function runAction(button) {
  if (button.disabled || !window.confirm(actionPrompt(button))) return;
  button.disabled = true;
  setActionFeedback('Applying action…');
  try {
    const response = await fetch('/api/actions', {
      method: 'POST',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: button.dataset.actionType,
        action: button.dataset.action,
        id: Number(button.dataset.resourceId),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || 'The action could not be completed.');
    setActionFeedback(actionDescription(button));
    await refresh();
  } catch (error) {
    setActionFeedback(error instanceof Error ? error.message : 'The action could not be completed.', true);
  } finally {
    button.disabled = false;
  }
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
    let controls = null;
    try {
      const controlsResponse = await fetch('/api/control-state', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const controlsBody = await controlsResponse.json();
      if (!controlsResponse.ok) throw new Error(controlsBody?.error?.message || 'Workflow and runner controls could not be loaded.');
      controls = controlsBody;
    } catch (error) {
      controls = { error: error instanceof Error ? error.message : 'Workflow and runner controls could not be loaded.' };
    }
    render(body, controls);
  } catch (error) {
    showRefreshError(error instanceof Error ? error.message : 'GitHub Actions data could not be loaded.');
  } finally {
    refreshInProgress = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = 'Refresh now';
  }
}

elements.refresh.addEventListener('click', refresh);
document.addEventListener('click', (event) => {
  if (event.target === elements.detailClose) { closeRunDetails(); return; }
  const details = event.target.closest('button[data-detail-run-id]');
  if (details) { openRunDetails(details); return; }
  const button = event.target.closest('button[data-action-type]');
  if (button) runAction(button);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectedRunId !== null) closeRunDetails();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
window.setInterval(refresh, POLL_INTERVAL_MS);
refresh();
