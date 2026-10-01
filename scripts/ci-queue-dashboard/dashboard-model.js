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

  function estimateRemainingMs(run, history, nowMs = Date.now()) {
    if (!run.startedAt || !Number.isFinite(Date.parse(run.startedAt))) return null;
    const runtimes = (Array.isArray(history) ? history : [])
      .filter((item) => item.status === 'completed'
        && (run.workflowId ? item.workflowId === run.workflowId : item.workflow === run.workflow))
      .map((item) => Date.parse(item.completedAt) - Date.parse(item.startedAt))
      .filter((duration) => Number.isFinite(duration) && duration > 0)
      .sort((a, b) => a - b);
    if (!runtimes.length) return null;
    const middle = Math.floor(runtimes.length / 2);
    const median = runtimes.length % 2
      ? runtimes[middle]
      : (runtimes[middle - 1] + runtimes[middle]) / 2;
    const elapsed = nowMs - Date.parse(run.startedAt);
    return Math.round(median - elapsed);
  }

  function durationMs(startValue, endValue) {
    if (!startValue || !endValue) return null;
    const start = Date.parse(startValue);
    const end = typeof endValue === 'number' ? endValue : Date.parse(endValue);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
  }

  function executionDurationMs(work, nowMs = Date.now()) {
    const end = work.status === 'in_progress' ? nowMs : work.completedAt;
    return durationMs(work.startedAt, end);
  }

  function runDurations(run, nowMs = Date.now()) {
    const waiting = runTimingKind(run.status) === 'waiting';
    return {
      queueWaitMs: durationMs(run.createdAt, waiting ? nowMs : run.startedAt),
      // completedAt preserves the existing card/ETA update-time fallback. Details
      // use only the explicit workflow completion timestamp supplied by GitHub.
      executionMs: waiting ? null : executionDurationMs({ ...run, completedAt: run.runCompletedAt }, nowMs),
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

  function stepKey(run, job, step) {
    return `${run.workflowId || run.workflow}|${job.name}|${step.name}`;
  }

  // Typical (median) duration of each step, from the completed runs on screen.
  function stepBaselines(runs) {
    const samples = new Map();
    for (const run of Array.isArray(runs) ? runs : []) {
      if (run.status !== 'completed') continue;
      for (const job of Array.isArray(run.jobs) ? run.jobs : []) {
        for (const step of Array.isArray(job.steps) ? job.steps : []) {
          if (step.conclusion !== 'success') continue;
          const duration = durationMs(step.startedAt, step.completedAt);
          if (duration === null) continue;
          const key = stepKey(run, job, step);
          samples.set(key, [...(samples.get(key) || []), duration]);
        }
      }
    }
    const baselines = new Map();
    for (const [key, values] of samples) {
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      baselines.set(key, values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
    }
    return baselines;
  }

  // The step that has taken longest in a job so far, with its typical duration
  // when one is known. `slow` means well over typical, not merely the longest.
  function slowestStep(run, job, baselines, nowMs = Date.now()) {
    let slowest = null;
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      const elapsedMs = executionDurationMs(step, nowMs);
      if (elapsedMs === null || (slowest && elapsedMs <= slowest.elapsedMs)) continue;
      const typicalMs = baselines?.get(stepKey(run, job, step)) ?? null;
      slowest = { name: step.name || 'Step', elapsedMs, typicalMs, slow: typicalMs !== null && elapsedMs > typicalMs * 1.5 && elapsedMs - typicalMs > 30000 };
    }
    return slowest;
  }

  const model = { classifyRuns, runTimingKind, runnerDetails, estimateRemainingMs, runDurations, executionDurationMs, stepBaselines, stepKey, slowestStep };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CiQueueDashboardModel = model;
})(typeof window === 'undefined' ? globalThis : window);
