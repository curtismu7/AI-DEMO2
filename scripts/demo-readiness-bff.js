'use strict';

// Runs the readiness audit inside the BFF through its admin job routes, so the
// effective configuration (flags, A2A credentials, PAR settings) is read by the
// process that holds it. It starts a run and reads its snapshots. It never
// confirms a repair: a repair preview is returned for the administrator to apply
// from Admin sidebar Reset Demo.

const { redactReadinessValue } = require('../demo_api_server/services/demoReadinessReport');

const JOBS_PATH = '/api/admin/demo-readiness/jobs';
const POLL_MS = 2000;
const DEADLINE_MS = 16 * 60 * 1000;
const FINISHED = new Set(['ready', 'not-ready', 'deadline-exceeded']);

async function request(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('BFF readiness request failed: HTTP ' + response.status + (body.error ? ' ' + body.error : ''));
  }
  return body;
}

/**
 * Starts one BFF readiness job and follows it until it finishes, waits for a
 * repair confirmation, or fails. Returns the run's report in the same shape the
 * in-process runner returns.
 */
async function runThroughBff({
  baseUrl,
  token,
  targets = ['local', 'se'],
  providers = ['pingone', 'pingfederate'],
  onProgress = () => {},
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  clock = Date.now,
} = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const deadline = clock() + DEADLINE_MS;
  let snapshot = await request(fetchImpl, base + JOBS_PATH, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, providers }),
  });
  let lastPhase = null;

  for (;;) {
    const phase = snapshot.progress?.phase || null;
    if (phase && phase !== lastPhase) {
      lastPhase = phase;
      await onProgress({ phase });
    }
    if (snapshot.status === 'failed') throw new Error(redactReadinessValue(snapshot.error || 'Readiness run failed in the BFF.'));
    if (FINISHED.has(snapshot.status)) return redactReadinessValue(snapshot.report);
    if (snapshot.status === 'awaiting-confirmation') {
      return {
        ready: false,
        status: 'awaiting-confirmation',
        label: 'NOT READY — repairs need Admin sidebar Reset Demo',
        repairPreview: redactReadinessValue(snapshot.preview),
        checks: [],
      };
    }
    if (clock() >= deadline) throw new Error('BFF readiness run did not finish within 16 minutes.');
    await sleep(POLL_MS);
    snapshot = await request(fetchImpl, base + JOBS_PATH + '/' + encodeURIComponent(snapshot.jobId), { headers });
  }
}

module.exports = { JOBS_PATH, POLL_MS, DEADLINE_MS, runThroughBff };
