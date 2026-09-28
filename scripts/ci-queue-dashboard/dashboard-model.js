'use strict';

(function exposeModel(root) {
  function classifyRuns(runs) {
    const groups = { inProgress: [], queued: [], completed: [] };
    for (const run of Array.isArray(runs) ? runs : []) {
      const status = String(run.status || '').toLowerCase();
      if (status === 'in_progress') groups.inProgress.push(run);
      else if (['queued', 'requested', 'waiting', 'pending'].includes(status)) groups.queued.push(run);
      else if (status === 'completed') groups.completed.push(run);
    }
    return groups;
  }

  const model = { classifyRuns };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CiQueueDashboardModel = model;
})(typeof window === 'undefined' ? globalThis : window);
