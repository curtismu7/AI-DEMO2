'use strict';

const { startReadinessRun } = require('../services/demoReadinessRunner');

function harness(overrides = {}) {
  const calls = [];
  const adapters = {
    checkPrerequisites: async () => { calls.push('prerequisites'); return [{ id: 'runtime', status: 'pass' }]; },
    audit: async ({ phase }) => { calls.push('audit:' + phase); return [{ id: 'config', status: phase === 'initial' ? 'fail' : 'pass', repairCandidate: phase === 'initial' ? { repairClass: 'test', target: 'local', object: { id: 'object' }, current: 'old', expected: 'new', sourceRef: 'source', operation: 'set value' } : undefined }]; },
    planRepairs: async () => { calls.push('preview'); return { digest: 'abc123', changes: [{ operation: 'set value', secret: 'client_secret=hidden' }], blocked: [] }; },
    applyRepairs: async ({ digest }) => { calls.push('apply:' + digest); return { digest, evidence: [] }; },
    execute: async () => { calls.push('execute'); return { rows: [{ id: 'row', status: 'pass' }], expectedRowIds: ['row'], categoryCounts: { total: 1 } }; },
    ...overrides,
  };
  return { calls, adapters };
}

describe('startReadinessRun', () => {
  test('empty prerequisite inventories block readiness before audit', async () => {
    const { calls, adapters } = harness({ checkPrerequisites: async () => [] });

    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });

    expect(calls).not.toContain('audit:initial');
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'prerequisites:inventory', status: 'blocked' }));
  });

  test('empty initial audit inventories block readiness before repair preview', async () => {
    const { calls, adapters } = harness({ audit: async () => [] });

    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });

    expect(calls).not.toContain('preview');
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'audit:initial-inventory', status: 'blocked' }));
  });

  test('empty re-audit inventories block readiness before scenario execution', async () => {
    const { calls, adapters } = harness({ audit: async ({ phase }) => phase === 'initial'
      ? [{ id: 'config', status: 'fail', repairCandidate: { repairClass: 'test', target: 'local', object: { id: 'object' }, current: 'old', expected: 'new' } }]
      : [] });

    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) });

    expect(calls).toContain('apply:abc123');
    expect(calls).not.toContain('execute');
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'audit:after-repair-inventory', status: 'blocked' }));
  });

  test.each(['prerequisites', 'repair-preview-ready'])('deadline bounds a stalled %s progress callback', async (stalledPhase) => {
    const { adapters } = harness({ audit: async () => [{ id: 'config', status: 'pass' }], planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }) });
    const result = await startReadinessRun({
      targets: ['local', 'se'], adapters, deadlineMs: 30,
      onProgress: async ({ phase }) => {
        if (phase === stalledPhase) return new Promise(() => {});
      },
    });

    expect(result.status).toBe('deadline-exceeded');
    expect(result.ready).toBe(false);
  });

  test('runs phases in order and binds apply to the displayed digest', async () => {
    const { calls, adapters } = harness();
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) });
    expect(calls).toEqual(['prerequisites', 'audit:initial', 'preview', 'apply:abc123', 'audit:after-repair', 'execute']);
    expect(result.status).toBe('ready');
    expect(result.checks.find((row) => row.id === 'config').resolvedByRepair).toBe(true);
  });

  test('includes the initial audit findings in the repair preview progress snapshot', async () => {
    const { adapters } = harness();
    const progressEvents = [];

    await startReadinessRun({
      targets: ['local', 'se'],
      adapters,
      onProgress: async (event) => { progressEvents.push(event); },
      confirmRepairs: async () => false,
    });

    const previewEvent = progressEvents.find((event) => event.phase === 'repair-preview-ready');
    expect(previewEvent.checks).toContainEqual(expect.objectContaining({ id: 'config', status: 'fail', phase: 'audit-initial' }));
  });

  test('starts one deadline before prerequisites and includes confirmation wait', async () => {
    let now = 1_000;
    let deadlineSeen;
    const { adapters } = harness({
      checkPrerequisites: async ({ deadlineAt }) => { deadlineSeen = deadlineAt; now += 100; return [{ id: 'runtime', status: 'pass' }]; },
    });
    const result = await startReadinessRun({ targets: ['local'], adapters, clock: () => now, confirmRepairs: async ({ deadlineAt }) => { expect(deadlineAt).toBe(deadlineSeen); now = deadlineAt; return 'abc123'; } });
    expect(deadlineSeen).toBe(901_000);
    expect(result.status).toBe('deadline-exceeded');
    expect(result.rows.some((row) => row.status === 'not-run')).toBe(true);
  });

  test('declined or incorrect confirmation never writes or executes', async () => {
    for (const answer of [false, 'wrong']) {
      const { calls, adapters } = harness();
      const result = await startReadinessRun({ targets: ['local'], adapters, confirmRepairs: async () => answer });
      expect(calls).not.toContain('apply:abc123');
      expect(calls).not.toContain('execute');
      expect(result.status).toBe('not-ready');
    }
  });

  test('an audit blocker prevents repair writes and matrix execution', async () => {
    const { calls, adapters } = harness({ audit: async () => { calls.push('audit:initial'); return [{ id: 'policy', status: 'blocked' }]; } });
    const result = await startReadinessRun({ targets: ['local'], adapters, confirmRepairs: async () => 'abc123' });
    expect(calls).not.toContain('apply:abc123');
    expect(calls).not.toContain('execute');
    expect(result.status).toBe('not-ready');
  });

  test('re-audits after applying repairs before scenarios and blocks on re-audit failure', async () => {
    const { calls, adapters } = harness({ audit: async ({ phase }) => { calls.push('audit:' + phase); return [{ id: 'config', status: phase === 'initial' ? 'fail' : 'blocked', repairCandidate: { repairClass: 'test', target: 'local', object: { id: 'object' }, current: 'old', expected: 'new' } }]; } });
    const result = await startReadinessRun({ targets: ['local'], adapters, confirmRepairs: async () => 'abc123' });
    expect(calls.indexOf('audit:after-repair')).toBeLessThan(calls.indexOf('execute') < 0 ? Infinity : calls.indexOf('execute'));
    expect(calls).not.toContain('execute');
    expect(result.status).toBe('not-ready');
  });

  test('every failed, blocked, unknown, or unfinished matrix row prevents READY', async () => {
    for (const status of ['fail', 'blocked', 'unknown', 'not-run']) {
      const { calls, adapters } = harness({ audit: async () => [{ id: 'config', status: 'pass' }], planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }), execute: async () => { calls.push('execute'); return { rows: [{ id: 'required', status }], expectedRowIds: ['required'], categoryCounts: { total: 1 } }; } });
      const result = await startReadinessRun({ targets: ['local', 'se'], adapters });
      expect(calls).toContain('execute');
      expect(result.status).toBe('not-ready');
    }
  });

  test('empty scenario results cannot complete READY', async () => {
    const { calls, adapters } = harness({
      audit: async () => [{ id: 'config', status: 'pass' }],
      planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }),
      execute: async () => { calls.push('execute'); return { rows: [], expectedRowIds: ['required'], categoryCounts: { total: 1 } }; },
    });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });
    expect(calls).toContain('execute');
    expect(result.ready).toBe(false);
    expect(result.status).toBe('not-ready');
    expect(result.rows.some((row) => row.id === 'scenario-matrix:coverage' && row.status === 'blocked')).toBe(true);
  });

  test('an incomplete scenario row count cannot complete READY', async () => {
    const { adapters } = harness({
      audit: async () => [{ id: 'config', status: 'pass' }],
      planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }),
      execute: async () => ({ rows: [{ id: 'required-a', status: 'pass' }], expectedRowIds: ['required-a', 'required-b'], categoryCounts: { total: 2 } }),
    });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });
    expect(result.ready).toBe(false);
    expect(result.rows.some((row) => row.id === 'scenario-matrix:coverage' && row.status === 'blocked')).toBe(true);
  });

  test('category counts without manifest row IDs cannot complete READY', async () => {
    const { adapters } = harness({
      audit: async () => [{ id: 'config', status: 'pass' }],
      planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }),
      execute: async () => ({ rows: [{ id: 'required-a', status: 'pass' }], categoryCounts: { total: 1 } }),
    });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });
    expect(result.ready).toBe(false);
    expect(result.rows.some((row) => row.id === 'scenario-matrix:coverage' && row.status === 'blocked')).toBe(true);
  });

  test('runner does not finalize deadline while apply side effect is active', async () => {
    let releaseApply;
    let applyStarted;
    const started = new Promise((resolve) => { applyStarted = resolve; });
    const gate = new Promise((resolve) => { releaseApply = resolve; });
    const { adapters } = harness({ applyRepairs: async ({ digest, signal }) => { applyStarted(signal); await gate; return { digest, evidence: [{ after: 'verified-after-timeout' }] }; } });
    let finalized = false;
    const running = startReadinessRun({ targets: ['local', 'se'], adapters, deadlineMs: 150, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) }).finally(() => { finalized = true; });
    const signal = await started;
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(signal.aborted).toBe(true);
    expect(finalized).toBe(false);
    releaseApply();
    const result = await running;
    expect(result.status).toBe('deadline-exceeded');
    expect(result.repairEvidence.evidence).toEqual([{ after: 'verified-after-timeout' }]);
    expect(finalized).toBe(true);
  });

  test('deadline after apply settles preserves readback evidence in the final report', async () => {
    let now = 1_000;
    const { calls, adapters } = harness({
      applyRepairs: async ({ digest }) => { now = 2_000; return { digest, evidence: [{ after: 'verified-after-deadline' }] }; },
    });
    const result = await startReadinessRun({
      targets: ['local', 'se'], adapters, clock: () => now, deadlineMs: 1_000,
      confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }),
    });
    expect(result.status).toBe('deadline-exceeded');
    expect(result.repairEvidence).toEqual({ digest: 'abc123', evidence: [{ after: 'verified-after-deadline' }] });
    expect(result.report.repairEvidence).toEqual({ digest: 'abc123', evidence: [{ after: 'verified-after-deadline' }] });
    expect(calls).not.toContain('execute');
  });

  test('failed apply/readback never launches the scenario matrix', async () => {
    const { calls, adapters } = harness({ applyRepairs: async () => { calls.push('apply:abc123'); throw new Error('readback failed'); } });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) });
    expect(calls).not.toContain('execute');
    expect(result.status).toBe('not-ready');
    expect(result.checks.find((row) => row.id === 'repair:apply').status).toBe('blocked');
  });

  test('failed apply retains its observed readback evidence in both report views', async () => {
    const evidence = [{ after: ['read', 'unexpected'], outcome: 'readback-mismatch' }];
    const { adapters } = harness({
      applyRepairs: async () => {
        const error = new Error('repair readback does not match the expected value');
        error.repairEvidence = evidence;
        throw error;
      },
    });

    const result = await startReadinessRun({
      targets: ['local', 'se'], adapters,
      confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }),
    });

    expect(result.repairEvidence).toEqual({ digest: 'abc123', evidence });
    expect(result.report.repairEvidence).toEqual({ digest: 'abc123', evidence });
    expect(result.ready).toBe(false);
  });

  test('apply acknowledgement must carry the exact preview digest', async () => {
    const { calls, adapters } = harness({ applyRepairs: async () => { calls.push('apply:abc123'); return { digest: 'different' }; } });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) });
    expect(calls).not.toContain('execute');
    expect(result.status).toBe('not-ready');
    expect(result.checks.find((row) => row.id === 'repair:apply-digest').status).toBe('blocked');
  });

  test('single-target success is diagnostic and can never be full READY', async () => {
    const { adapters } = harness({ audit: async () => [{ id: 'config', status: 'pass' }], planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }), execute: async () => ({ rows: [{ id: 'required', status: 'pass' }], expectedRowIds: ['required'], categoryCounts: { total: 1 } }) });
    const result = await startReadinessRun({ targets: ['local'], adapters, confirmRepairs: async () => true });
    expect(result.ready).toBe(false);
    expect(result.label).toMatch(/diagnostic/i);
  });

  test('confirmed digest without an administrator assertion cannot write', async () => {
    const { calls, adapters } = harness();
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, confirmRepairs: async ({ digest }) => digest });
    expect(calls).not.toContain('apply:abc123');
    expect(result.checks.find((row) => row.id === 'repair:administrator-assertion').status).toBe('blocked');
  });

  test('deadline abort signal reaches an in-flight repair before timeout is reported', async () => {
    let observedSignal;
    let wroteAfterAbort = false;
    const { adapters } = harness({
      applyRepairs: async ({ digest, signal }) => {
        observedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 1_300));
        if (!signal.aborted) wroteAfterAbort = true;
        return { digest };
      },
    });
    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, deadlineMs: 1_000, confirmRepairs: async ({ digest }) => ({ confirmed: true, digest, adminAssertion: { subject: 'readiness-admin' } }) });
    expect(result.status).toBe('deadline-exceeded');
    expect(observedSignal.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(wroteAfterAbort).toBe(false);
  });

  test('redacts credentials from returned report evidence', async () => {
    const { adapters } = harness({ audit: async () => [{ id: 'check', status: 'blocked', evidence: { authorization: 'Bearer secret-token', client_secret: 'secret' } }] });
    const result = await startReadinessRun({ targets: ['local'], adapters });
    expect(JSON.stringify(result)).not.toMatch(/secret-token|"client_secret":"secret"/);
  });
});
