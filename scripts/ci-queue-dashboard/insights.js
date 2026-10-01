'use strict';

// Pure derivations over raw GitHub API objects (workflow runs, pulls, jobs).
// Nothing here calls GitHub; github.js feeds it and server.js serves the result.

const ACTIVE_STATUSES = new Set(['queued', 'requested', 'waiting', 'pending', 'in_progress']);
const DECISIVE_CONCLUSIONS = new Set(['success', 'failure', 'timed_out']);

function isActive(run) {
  return ACTIVE_STATUSES.has(String(run?.status || ''));
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// 1. A pull_request run still queued or running after its PR merged or closed
//    holds a runner for a result nobody will read.
function staleRuns(runs, openPulls, closedPulls) {
  const open = new Set((openPulls || []).map((pull) => pull?.head?.ref).filter(Boolean));
  const closed = new Map();
  for (const pull of closedPulls || []) {
    const ref = pull?.head?.ref;
    if (ref && !closed.has(ref)) closed.set(ref, pull); // lists arrive newest-first
  }
  return (runs || [])
    .filter((run) => run.event === 'pull_request' && isActive(run) && !open.has(run.head_branch) && closed.has(run.head_branch))
    .map((run) => {
      const pull = closed.get(run.head_branch);
      return { id: Number(run.id), pr: Number(pull.number), state: pull.merged_at ? 'merged' : 'closed' };
    });
}

// 7. Two active runs of the same workflow on the same commit (typically a PR
//    run plus a manual run) do the same work twice. The oldest is the original.
function duplicateRuns(runs) {
  const groups = new Map();
  for (const run of (runs || []).filter(isActive)) {
    if (!run.head_sha) continue;
    const key = `${run.workflow_id}|${run.head_sha}`;
    groups.set(key, [...(groups.get(key) || []), run]);
  }
  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
    for (const run of group.slice(1)) duplicates.push({ id: Number(run.id), duplicateOf: Number(group[0].id) });
  }
  return duplicates;
}

function pullNumberFromTitle(title) {
  const match = /#(\d+)\b/.exec(String(title || ''));
  return match ? Number(match[1]) : null;
}

function runRef(run) {
  return {
    id: Number(run.id),
    title: run.display_title || run.name || 'Workflow run',
    sha: String(run.head_sha || '').slice(0, 9),
    pr: pullNumberFromTitle(run.display_title),
    url: run.html_url || '',
  };
}

// 4. Health of the default branch for one workflow. Cancelled and skipped runs
//    say nothing, so they are ignored. `firstBad` is the oldest failure since
//    the last green run — the merge to look at first.
function mainHealth(runs, { branch = 'main', workflowName = 'CI' } = {}) {
  const decisive = (runs || [])
    .filter((run) => run.head_branch === branch && run.name === workflowName
      && run.status === 'completed' && DECISIVE_CONCLUSIONS.has(run.conclusion))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
  if (!decisive.length) return { state: 'unknown', branch, workflow: workflowName };
  const latest = decisive[0];
  if (latest.conclusion === 'success') return { state: 'green', branch, workflow: workflowName, latest: runRef(latest) };
  let firstBad = latest;
  for (const run of decisive) {
    if (run.conclusion === 'success') break;
    firstBad = run;
  }
  return { state: 'red', branch, workflow: workflowName, latest: runRef(latest), firstBad: runRef(firstBad) };
}

// The alert job fails BECAUSE another job failed; naming it explains nothing.
function failedJobNames(jobs) {
  return (jobs || [])
    .filter((job) => ['failure', 'timed_out'].includes(job.conclusion) && !/^Main is red\b/.test(String(job.name || '')))
    .map((job) => String(job.name || 'Job'));
}

// 6. Median time from trigger to result, per UTC day: queue wait plus run time.
//    GitHub's run_started_at is the trigger time, not the runner pickup, so
//    the runs list cannot separate the two; pickup lives on each run's jobs.
//    Only runs that reached a real result count — a cancelled run has none.
function turnaroundTrend(runs, { days = 7 } = {}) {
  const byDay = new Map();
  for (const run of runs || []) {
    if (run.status !== 'completed' || !DECISIVE_CONCLUSIONS.has(run.conclusion)) continue;
    const created = Date.parse(run.created_at);
    const finished = Date.parse(run.updated_at);
    if (!Number.isFinite(created) || !Number.isFinite(finished) || finished < created) continue;
    const day = new Date(created).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) || []), finished - created]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([day, times]) => ({ day, medianMs: Math.round(median(times)), runs: times.length }));
}

// 5. Who changed a workflow's enabled state. The dashboard notes its own
//    actions; any other observed change came from outside it (gh CLI, the
//    GitHub UI, or another agent session).
// ponytail: in-memory, lost on restart; write to a file if history matters.
function createControlLog({ now = () => new Date(), limit = 20, attributionWindowMs = 60_000 } = {}) {
  const lastState = new Map();
  const pending = new Map();
  const entries = [];

  function noteDashboardAction(workflowId) {
    pending.set(Number(workflowId), now().getTime());
  }

  function observe(workflows) {
    for (const workflow of workflows || []) {
      const previous = lastState.get(workflow.id);
      lastState.set(workflow.id, workflow.state);
      if (previous === undefined || previous === workflow.state) continue;
      const notedAt = pending.get(workflow.id);
      pending.delete(workflow.id);
      const fromDashboard = notedAt !== undefined && now().getTime() - notedAt <= attributionWindowMs;
      entries.unshift({
        at: now().toISOString(),
        workflow: workflow.name,
        change: workflow.state === 'active' ? 'resumed' : 'paused',
        source: fromDashboard ? 'dashboard' : 'outside',
      });
      entries.length = Math.min(entries.length, limit);
    }
    return entries.slice();
  }

  return { noteDashboardAction, observe };
}

module.exports = { createControlLog, duplicateRuns, failedJobNames, mainHealth, median, staleRuns, turnaroundTrend };
