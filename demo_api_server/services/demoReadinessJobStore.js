'use strict';

const crypto = require('crypto');
const { startReadinessRun } = require('./demoReadinessRunner');
const { redactReadinessValue } = require('./demoReadinessReport');

const JOB_TTL_MS = 20 * 60 * 1000;
const DEFAULT_TARGETS = Object.freeze(['local', 'se']);

class DemoReadinessJobError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'DemoReadinessJobError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function subjectDigest(subject) {
  return crypto.createHash('sha256').update(String(subject)).digest('hex');
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createDemoReadinessJobStore({
  runReadiness = startReadinessRun,
  now = Date.now,
  ttlMs = JOB_TTL_MS,
  createId = crypto.randomUUID,
} = {}) {
  const jobs = new Map();

  const snapshot = (job) => redactReadinessValue({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    progress: job.progress,
    preview: job.preview,
    report: job.report,
    error: job.error,
  });

  function expire(job) {
    if (jobs.get(job.id) !== job) return;
    clearTimeout(job.expiryTimer);
    jobs.delete(job.id);
    job.confirmation.resolve({ confirmed: false, digest: job.awaitingDigest || null });
  }

  function expireDueJobs() {
    const currentTime = now();
    for (const job of jobs.values()) {
      if (currentTime >= job.expiresAt) expire(job);
    }
  }

  function findOwnedJob(jobId, subject) {
    const job = jobs.get(jobId);
    if (!job) throw new DemoReadinessJobError(404, 'job_not_found', 'Readiness job was not found.');
    if (now() >= job.expiresAt) {
      expire(job);
      throw new DemoReadinessJobError(410, 'job_expired', 'Readiness job expired. Start a new run.');
    }
    if (job.ownerDigest !== subjectDigest(subject)) {
      throw new DemoReadinessJobError(403, 'job_forbidden', 'This readiness job belongs to another administrator.');
    }
    return job;
  }

  function start({ subject } = {}) {
    if (typeof subject !== 'string' || !subject.trim()) {
      throw new DemoReadinessJobError(401, 'authenticated_subject_required', 'A verified administrator subject is required.');
    }
    expireDueJobs();

    const createdAt = now();
    const job = {
      id: createId(),
      ownerDigest: subjectDigest(subject),
      createdAt,
      expiresAt: createdAt + ttlMs,
      status: 'running',
      progress: null,
      preview: null,
      report: null,
      error: null,
      awaitingDigest: null,
      confirmedDigest: null,
      confirmation: deferred(),
      expiryTimer: null,
    };
    job.expiryTimer = setTimeout(() => expire(job), ttlMs);
    job.expiryTimer.unref?.();
    jobs.set(job.id, job);

    const onProgress = async (event) => {
      if (jobs.get(job.id) !== job || now() >= job.expiresAt) return;
      const safeEvent = redactReadinessValue(event);
      job.progress = safeEvent;
      if (safeEvent?.phase === 'repair-preview-ready' && safeEvent.preview) {
        job.preview = redactReadinessValue(safeEvent.preview);
        const changes = safeEvent.preview.changes;
        if (Array.isArray(changes) && changes.length > 0
            && (!Array.isArray(safeEvent.preview.blocked) || safeEvent.preview.blocked.length === 0)
            && typeof safeEvent.preview.digest === 'string' && safeEvent.preview.digest) {
          job.awaitingDigest = safeEvent.preview.digest;
          if (job.confirmedDigest !== job.awaitingDigest) job.status = 'awaiting-confirmation';
        }
      }
    };

    const confirmRepairs = async ({ digest, preview } = {}) => {
      if (jobs.get(job.id) !== job || now() >= job.expiresAt) {
        expire(job);
        return { confirmed: false, digest };
      }
      if (job.confirmedDigest === digest) return job.confirmation.promise;
      job.awaitingDigest = digest;
      job.preview = redactReadinessValue(preview);
      job.status = 'awaiting-confirmation';
      return job.confirmation.promise;
    };

    job.runPromise = Promise.resolve().then(() => runReadiness({
      targets: [...DEFAULT_TARGETS],
      onProgress,
      confirmRepairs,
    })).then((result) => {
      if (jobs.get(job.id) !== job) return;
      job.report = redactReadinessValue(result);
      job.status = result?.status === 'deadline-exceeded' ? 'deadline-exceeded' : result?.ready === true ? 'ready' : 'not-ready';
    }).catch((error) => {
      if (jobs.get(job.id) !== job) return;
      job.status = 'failed';
      job.error = redactReadinessValue(error?.message || 'Readiness run failed.');
    });

    return snapshot(job);
  }

  function get({ jobId, subject } = {}) {
    return snapshot(findOwnedJob(jobId, subject));
  }

  function confirm({ jobId, subject, digest, adminAssertion } = {}) {
    const job = findOwnedJob(jobId, subject);
    if (typeof digest !== 'string' || !digest) {
      throw new DemoReadinessJobError(400, 'repair_digest_required', 'The exact repair preview digest is required.');
    }
    if (job.confirmedDigest) {
      throw new DemoReadinessJobError(409, 'confirmation_already_used', 'This repair preview was already confirmed.');
    }
    if (job.status !== 'awaiting-confirmation' || !job.preview) {
      throw new DemoReadinessJobError(409, 'confirmation_not_pending', 'This job is not waiting for repair confirmation.');
    }
    if (digest !== job.awaitingDigest || digest !== job.preview.digest) {
      throw new DemoReadinessJobError(409, 'repair_digest_mismatch', 'The repair preview changed. Start a new readiness run.');
    }
    if (!adminAssertion || adminAssertion.subject !== subject) {
      throw new DemoReadinessJobError(403, 'administrator_assertion_invalid', 'A verified administrator confirmation is required.');
    }
    job.confirmedDigest = digest;
    job.status = 'running';
    job.confirmation.resolve({ confirmed: true, digest, adminAssertion });
    return snapshot(job);
  }

  function dispose() {
    for (const job of jobs.values()) expire(job);
  }

  return { start, get, confirm, dispose };
}

module.exports = { JOB_TTL_MS, DEFAULT_TARGETS, DemoReadinessJobError, createDemoReadinessJobStore };
