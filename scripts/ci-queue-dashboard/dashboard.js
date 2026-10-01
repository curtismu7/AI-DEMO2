'use strict';

const POLL_INTERVAL_MS = 15000;
let refreshInProgress = false;
let currentSnapshot = null;
let currentInsights = null;
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
  mainHealth: document.getElementById('main-health'),
  staleRuns: document.getElementById('stale-runs'),
  staleSummary: document.getElementById('stale-summary'),
  staleCancel: document.getElementById('stale-cancel'),
  hostLoad: document.getElementById('host-load'),
  hostLoadFigure: document.getElementById('host-load-figure'),
  hostLoadContent: document.getElementById('host-load-content'),
  workflowLog: document.getElementById('workflow-log'),
  waitTrend: document.getElementById('wait-trend'),
  waitTrendContent: document.getElementById('wait-trend-content'),
  deployPanel: document.getElementById('deploy-panel'),
  deployState: document.getElementById('deploy-state'),
  deployLocal: document.getElementById('deploy-local'),
  deployRecent: document.getElementById('deploy-recent'),
  deployBuilds: document.getElementById('deploy-builds'),
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

function currentStepTimings(run) {
  const rows = [];
  const model = window.CiQueueDashboardModel;
  const nowMs = Date.now();
  for (const job of Array.isArray(run.jobs) ? run.jobs : []) {
    if (normalized(job.status) !== 'in_progress') continue;
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (normalized(step.status) !== 'in_progress') continue;
      const row = node('div', 'run-current-step');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `Current step for ${job.name || 'Job'}: ${step.name || 'Step'}`);
      row.append(node('span', 'run-current-step-label', 'Current step'));
      row.append(node('strong', 'run-current-step-job', job.name || 'Job'));
      row.append(node('span', 'run-current-step-name', step.name || 'Step'));
      row.append(node('span', 'run-current-step-time', `Elapsed: ${formatElapsed(model.executionDurationMs(step, nowMs))}`));
      rows.push(row);
    }
    const slowest = model.slowestStep(run, job, model.stepBaselines(currentSnapshot?.runs), nowMs);
    if (slowest) {
      const typical = slowest.typicalMs === null ? '' : ` (typically ${formatElapsed(slowest.typicalMs)})`;
      rows.push(node('div', `run-slowest-step${slowest.slow ? ' run-slowest-step--slow' : ''}`,
        `Slowest step in ${job.name || 'Job'}: ${slowest.name}, ${formatElapsed(slowest.elapsedMs)}${typical}`));
    }
  }
  if (rows.length === 0) return null;
  const summary = node('div', 'run-current-steps');
  summary.append(...rows);
  return summary;
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
  const stale = currentInsights?.staleRuns?.find((item) => item.id === run.id);
  if (stale) metadata.append(node('span', 'run-flag run-flag--stale', `Stale: PR #${stale.pr} is ${stale.state}`));
  const duplicate = currentInsights?.duplicateRuns?.find((item) => item.id === run.id);
  if (duplicate) metadata.append(node('span', 'run-flag run-flag--duplicate', `Duplicate of run ${duplicate.duplicateOf} (same commit)`));

  article.append(header, metadata);
  const activeSteps = currentStepTimings(run);
  if (activeSteps) article.append(activeSteps);
  article.append(addJobTable(run, compact));
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
      const baselines = model.stepBaselines(currentSnapshot.runs);
      const slowest = model.slowestStep(run, job, baselines, nowMs);
      for (const step of job.steps) {
        const current = normalized(step.status) === 'in_progress';
        const row = node('li', `detail-step${current ? ' detail-step--current' : ''}`);
        if (current) row.setAttribute('aria-current', 'step');
        row.append(node('span', 'detail-step-name', step.name || 'Step'), makeStatus(step.status, step.conclusion));
        if (current) row.append(node('strong', 'detail-current', 'Current step'));
        row.append(node('span', 'job-timing', `Elapsed: ${formatElapsed(model.executionDurationMs(step, nowMs))}`));
        const typicalMs = baselines.get(model.stepKey(run, job, step));
        if (typicalMs !== undefined) row.append(node('span', 'job-timing', `Typical: ${formatElapsed(typicalMs)}`));
        if (slowest && slowest.name === (step.name || 'Step') && slowest.elapsedMs > 0) {
          row.append(node('strong', `detail-slowest${slowest.slow ? ' detail-slowest--slow' : ''}`, slowest.slow ? 'Slowest step, over typical' : 'Slowest step'));
        }
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

function renderWorkflowLog(controls) {
  const entries = Array.isArray(controls?.workflowLog) ? controls.workflowLog : [];
  elements.workflowLog.replaceChildren(...entries.slice(0, 5).map((entry) => node('li', `workflow-log-entry workflow-log-entry--${entry.source === 'dashboard' ? 'dashboard' : 'outside'}`,
    `${formatLocalTime(entry.at)}: ${entry.workflow} ${entry.change} ${entry.source === 'dashboard' ? 'from this dashboard' : 'outside this dashboard (gh, GitHub, or another session)'}`)));
}

function renderMainHealth(main) {
  elements.mainHealth.replaceChildren();
  elements.mainHealth.hidden = main?.state !== 'red';
  if (main?.state !== 'red') return;
  const jobs = Array.isArray(main.failedJobs) && main.failedJobs.length ? main.failedJobs.join(', ') : 'job names unavailable';
  elements.mainHealth.append(node('strong', 'main-health-title', `${main.branch} is red: ${main.workflow}`));
  elements.mainHealth.append(node('span', 'main-health-detail', `Failing: ${jobs}`));
  const first = main.firstBad;
  if (first) {
    const source = first.pr ? `PR #${first.pr}` : first.sha ? `commit ${first.sha}` : 'an earlier run';
    elements.mainHealth.append(node('span', 'main-health-detail', `Red since ${source}: ${first.title}`));
  }
  const url = safeGitHubUrl(main.latest?.url);
  if (url) {
    const link = node('a', 'run-link', 'Open failing run');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    elements.mainHealth.append(link);
  }
}

function renderStaleRuns(insights) {
  const active = new Set((currentSnapshot?.runs || []).map((run) => run.id));
  const stale = (insights?.staleRuns || []).filter((item) => active.has(item.id));
  elements.staleRuns.hidden = stale.length === 0;
  elements.staleCancel.dataset.runIds = stale.map((item) => item.id).join(',');
  const pulls = [...new Set(stale.map((item) => `#${item.pr}`))].join(', ');
  elements.staleSummary.textContent = stale.length
    ? `${stale.length} queued or running ${stale.length === 1 ? 'run is' : 'runs are'} for pull requests that already merged or closed (${pulls}).`
    : '';
}

function renderHostLoad(host) {
  elements.hostLoad.hidden = !host;
  if (!host) return;
  const ratio = host.cores ? host.load1 / host.cores : 0;
  elements.hostLoadFigure.textContent = `Load ${host.load1} on ${host.cores} cores`;
  elements.hostLoad.dataset.pressure = ratio >= 2 ? 'high' : ratio >= 1 ? 'raised' : 'normal';
  elements.hostLoadContent.replaceChildren();
  if (ratio >= 1) {
    elements.hostLoadContent.append(node('p', 'host-load-note',
      `This Mac has ${ratio.toFixed(1)} times more runnable work than cores, so CI jobs will run slower than usual.`));
  }
  const list = node('ul', 'host-load-list');
  for (const item of Array.isArray(host.top) ? host.top : []) {
    list.append(node('li', 'host-load-item', `${item.name}: ${Math.round(item.cpuPercent)}% CPU, ${item.memMb} MB`));
  }
  elements.hostLoadContent.append(list);
}

function renderWaitTrend(trend) {
  const days = Array.isArray(trend) ? trend : [];
  elements.waitTrend.hidden = days.length === 0;
  const longest = Math.max(1, ...days.map((day) => day.medianMs));
  elements.waitTrendContent.replaceChildren(...days.map((day) => {
    const row = node('div', 'wait-trend-row');
    row.append(node('span', 'wait-trend-day', day.day));
    const bar = node('span', 'wait-trend-bar');
    // Width as a data attribute (CSP forbids inline styles); CSS maps it.
    bar.dataset.width = String(Math.max(1, Math.round((day.medianMs / longest) * 10)));
    row.append(bar);
    row.append(node('span', 'wait-trend-value', `${formatElapsed(day.medianMs)} median, ${day.runs} ${day.runs === 1 ? 'run' : 'runs'}`));
    return row;
  }));
}

function serviceSummary(services) {
  const shown = services.slice(0, 4).join(', ');
  return services.length > 4 ? `${shown} and ${services.length - 4} more` : shown;
}

function renderDeploy(deploy, builds) {
  const local = deploy?.available ? deploy : null;
  const buildList = Array.isArray(builds) ? builds : [];
  elements.deployPanel.hidden = !local && buildList.length === 0;
  if (elements.deployPanel.hidden) return;

  const pending = (local?.groups || []).filter((group) => group.commitsSince > 0);
  const running = Boolean(local?.lock?.running);
  elements.deployState.textContent = !local ? 'Local state unavailable'
    : running ? `Deploy running${local.lock.pid ? ` (process ${local.lock.pid})` : ''}`
      : pending.length ? 'Not fully deployed' : 'Up to date';
  elements.deployPanel.dataset.state = running ? 'running' : pending.length ? 'pending' : 'current';

  elements.deployLocal.replaceChildren();
  if (local) {
    const offMain = (local.served || []).filter((mount) => !mount.isMain);
    if (offMain.length) {
      elements.deployLocal.append(node('p', 'deploy-note deploy-note--warn',
        `Serving a worktree, not main: ${offMain.map((mount) => `${mount.mount} from ${mount.checkout}`).join(', ')}.`));
    }
    if (local.lock?.stale) elements.deployLocal.append(node('p', 'deploy-note deploy-note--warn', 'A deploy lock is left over from a process that has exited.'));
    for (const group of local.groups || []) {
      const row = node('div', `deploy-row${group.commitsSince > 0 ? ' deploy-row--pending' : ''}`);
      row.append(node('span', 'deploy-services', serviceSummary(group.services)));
      row.title = group.services.join(', ');
      const since = group.commitsSince === null ? 'commit count unavailable'
        : group.commitsSince === 0 ? `at the current commit (${group.sha})`
          : `deployed at ${group.sha}, ${group.commitsSince} ${group.commitsSince === 1 ? 'commit' : 'commits'} on disk since`;
      row.append(node('span', 'deploy-detail', since));
      elements.deployLocal.append(row);
    }
    if (pending.length) {
      elements.deployLocal.append(node('p', 'deploy-note', 'Counts every commit since the service was last deployed; not all of them touch it. Run scripts/deploy-live.sh --dry-run to see what would restart.'));
    }
    if (!(local.groups || []).length) elements.deployLocal.append(node('p', 'placeholder', 'No per-service deploy records on this machine.'));
  } else {
    elements.deployLocal.append(node('p', 'placeholder', 'Local deploy state is unavailable.'));
  }

  const recent = local?.recent || [];
  elements.deployRecent.replaceChildren(...(recent.length
    ? recent.map((entry) => node('div', 'deploy-row', `${formatLocalTime(entry.at)}: ${entry.sha} restarted ${entry.services.join(', ') || 'no services'}`))
    : [node('p', 'placeholder', 'No deploys recorded.')]));

  elements.deployBuilds.replaceChildren(...(buildList.length ? buildList.map((build) => {
    const row = node('div', 'deploy-row');
    row.append(makeStatus(build.status, build.conclusion));
    row.append(node('span', 'deploy-services', build.title));
    row.append(node('span', 'deploy-detail', `${build.sha}, ${formatLocalTime(build.createdAt)}`));
    const url = safeGitHubUrl(build.url);
    if (url) {
      const link = node('a', 'run-link', 'Open run');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    }
    return row;
  }) : [node('p', 'placeholder', 'No image builds in the 100 most recent runs.')]));
}

function renderInsights(insights) {
  renderMainHealth(insights?.main);
  renderStaleRuns(insights);
  renderHostLoad(insights?.host);
  renderWaitTrend(insights?.turnaroundTrend);
  renderDeploy(insights?.deploy, insights?.imageBuilds);
}

function renderWorkflowControls(controls) {
  renderWorkflowLog(controls);
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
      row.append(node('span', 'control-state', runner.localInstalled ? 'Stopped on this Mac' : 'Runs on another machine'));
    }
    elements.runnerControls.append(row);
  }
  if (!hasLocalControl) elements.runnerControlNote.textContent = 'Pause and resume appear only for runners whose service is loaded on this Mac.';
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

function render(snapshot, controls, insights = null) {
  currentSnapshot = snapshot;
  currentInsights = insights;
  renderInsights(insights);
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
    // Insights are extra: if they fail, the queue still renders without them.
    let insights = null;
    try {
      const insightsResponse = await fetch('/api/insights', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (insightsResponse.ok) insights = await insightsResponse.json();
    } catch {}
    render(body, controls, insights);
  } catch (error) {
    showRefreshError(error instanceof Error ? error.message : 'GitHub Actions data could not be loaded.');
  } finally {
    refreshInProgress = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = 'Refresh now';
  }
}

async function cancelStaleRuns() {
  const ids = String(elements.staleCancel.dataset.runIds || '').split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length || !window.confirm(`Stop ${ids.length} ${ids.length === 1 ? 'run' : 'runs'} for pull requests that already merged or closed?`)) return;
  elements.staleCancel.disabled = true;
  setActionFeedback('Stopping stale runs…');
  let stopped = 0;
  for (const id of ids) {
    try {
      const response = await fetch('/api/actions', {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'run', action: 'cancel', id }),
      });
      if (response.ok) stopped += 1;
    } catch {}
  }
  setActionFeedback(`Stop request sent for ${stopped} of ${ids.length} stale runs.`, stopped !== ids.length);
  elements.staleCancel.disabled = false;
  await refresh();
}

elements.refresh.addEventListener('click', refresh);
document.addEventListener('click', (event) => {
  if (event.target === elements.detailClose) { closeRunDetails(); return; }
  if (event.target === elements.staleCancel) { cancelStaleRuns(); return; }
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
