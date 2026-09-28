'use strict';

(function exposeModel(root) {
  const WAITING_STATUSES = ['queued', 'requested', 'waiting', 'pending'];

  function runTimingKind(status) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (WAITING_STATUSES.includes(normalizedStatus)) return 'waiting';
    return normalizedStatus === 'in_progress' ? 'running' : 'finished';
  }

  function runnerDetails(job) {
    const name = String(job.runnerName || '').trim();
    const status = String(job.status || '').toLowerCase();
    const details = [];
    if (job.runnerGroup) details.push(`Group: ${job.runnerGroup}`);
    if (Array.isArray(job.labels) && job.labels.length) details.push(`Labels: ${job.labels.join(', ')}`);
    return {
      name: name || (WAITING_STATUSES.includes(status) ? 'Not assigned' : status === 'completed' ? 'Runner unavailable' : 'Runner not reported'),
      state: name ? 'assigned' : WAITING_STATUSES.includes(status) ? 'unassigned' : 'unavailable',
      details,
    };
  }

  function classifyRuns(runs) {
    const groups = { inProgress: [], queued: [], completed: [] };
    for (const run of Array.isArray(runs) ? runs : []) {
      const status = String(run.status || '').toLowerCase();
      if (status === 'in_progress') groups.inProgress.push(run);
      else if (runTimingKind(status) === 'waiting') groups.queued.push(run);
      else if (status === 'completed') groups.completed.push(run);
    }
    return groups;
  }

  const model = { classifyRuns, runTimingKind, runnerDetails };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CiQueueDashboardModel = model;
})(typeof window === 'undefined' ? globalThis : window);
