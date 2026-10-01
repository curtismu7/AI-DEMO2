'use strict';

const { createDefaultAdapters, startReadinessRun } = require('../services/demoReadinessRunner');
const { loadDemoReadinessRuntimeConfig } = require('../services/demoReadinessRuntimeConfig');

function configuredRuntime() {
  const env = {};
  for (const [target, host] of [['LOCAL', 'local.ping-devops.com'], ['SE', 'ai-demo.ping-devops.com']]) {
    env[`DEMO_READINESS_${target}_BFF_URL`] = `https://${host}:4000`;
    env[`DEMO_READINESS_${target}_GATEWAY_URL`] = `https://${host}/gateway/health`;
    env[`DEMO_READINESS_${target}_AUTHORIZE_URL`] = `https://${host}/authorize/health`;
    env[`DEMO_READINESS_${target}_EXPECTED_REVISION`] = 'a'.repeat(40);
    for (const provider of ['PINGONE', 'PINGFEDERATE']) {
      env[`DEMO_READINESS_${target}_${provider}_WORKER_URL`] = `https://${target.toLowerCase()}-${provider.toLowerCase()}.example`;
      env[`DEMO_READINESS_${target}_${provider}_WORKER_TOKEN`] = `${target}-${provider}-token`;
      env[`DEMO_READINESS_${target}_${provider}_IDENTITY_REF`] = `identity://${target.toLowerCase()}/${provider.toLowerCase()}`;
    }
  }
  return loadDemoReadinessRuntimeConfig(env);
}

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
  test('default prerequisites name missing target and isolated-worker settings before any audit', async () => {
    const names = [
      'DEMO_READINESS_LOCAL_BFF_URL', 'DEMO_READINESS_LOCAL_GATEWAY_URL', 'DEMO_READINESS_LOCAL_AUTHORIZE_URL', 'DEMO_READINESS_LOCAL_EXPECTED_REVISION',
      'DEMO_READINESS_SE_BFF_URL', 'DEMO_READINESS_SE_GATEWAY_URL', 'DEMO_READINESS_SE_AUTHORIZE_URL', 'DEMO_READINESS_SE_EXPECTED_REVISION',
      ...['LOCAL', 'SE'].flatMap((target) => ['PINGONE', 'PINGFEDERATE'].flatMap((provider) => [
        `DEMO_READINESS_${target}_${provider}_WORKER_URL`,
        `DEMO_READINESS_${target}_${provider}_WORKER_TOKEN`,
        `DEMO_READINESS_${target}_${provider}_IDENTITY_REF`,
      ])),
    ];
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];

    try {
      const result = await startReadinessRun();

      expect(result.checks).toContainEqual(expect.objectContaining({
        id: 'target:local:bff-url',
        status: 'blocked',
        evidence: expect.stringContaining('DEMO_READINESS_LOCAL_BFF_URL'),
      }));
      expect(result.checks).toContainEqual(expect.objectContaining({
        id: 'worker:se:pingfederate',
        status: 'blocked',
        evidence: expect.stringContaining('DEMO_READINESS_SE_PINGFEDERATE_IDENTITY_REF'),
      }));
      expect(result.checks).not.toContainEqual(expect.objectContaining({ id: 'provider-workers' }));
      expect(result.ready).toBe(false);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test('default prerequisites health-check only configured worker lanes for selected targets', async () => {
    const runtimeConfig = configuredRuntime();
    const fetchImpl = jest.fn(async (url, options) => {
      const targetId = url.includes('se-') ? 'se' : 'local';
      const provider = url.includes('pingfederate') ? 'pingfederate' : 'pingone';
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ready', targetId, provider,
          identityRef: runtimeConfig.targets[targetId].workers[provider].identityRef,
          workerId: `${targetId}-${provider}-process`,
          capabilities: ['readiness-context-v1', 'readiness-case-v1', 'readiness-feature-v1'],
        }),
      };
    });
    const adapters = createDefaultAdapters(Date.now, { runtimeConfig, fetchImpl });

    const rows = await adapters.checkPrerequisites({ targets: ['local'], deadlineAt: Date.now() + 5_000 });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'worker-health:local:pingone', status: 'pass' }),
      expect.objectContaining({ id: 'worker-health:local:pingfederate', status: 'pass' }),
    ]));
    expect(rows.some((row) => row.id.includes(':se:'))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(rows)).not.toMatch(/LOCAL-PINGONE-token|LOCAL-PINGFEDERATE-token/);
  });

  test('target audits receive only the selected target URLs and revision', async () => {
    const runtimeConfig = configuredRuntime();
    const auditTarget = jest.fn(async () => [{ id: 'audit-row', status: 'pass' }]);
    const adapters = createDefaultAdapters(Date.now, {
      runtimeConfig,
      audit: { auditTarget },
      fetchImpl: jest.fn(),
    });

    await adapters.audit({ targets: ['se'], deadlineAt: Date.now() + 5_000, phase: 'initial' });

    expect(auditTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'se',
      targetConfig: {
        kind: 'se',
        runtime: {
          bffUrl: runtimeConfig.targets.se.bffUrl,
          gatewayUrl: runtimeConfig.targets.se.gatewayUrl,
          authorizeUrl: runtimeConfig.targets.se.authorizeUrl,
          expectedRevision: runtimeConfig.targets.se.expectedRevision,
        },
      },
    }));
    expect(JSON.stringify(auditTarget.mock.calls)).not.toContain(runtimeConfig.targets.se.workers.pingone.token);
  });

  describe('authorize read bearer', () => {
    const env = { PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_WORKER_CLIENT_ID: 'worker', PINGONE_WORKER_CLIENT_SECRET: 'worker-secret' };
    const tokenFetch = () => jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'mgmt-token' }) }));
    const runtimeFor = async (authorizeUrl, fetchImpl) => {
      const runtimeConfig = configuredRuntime();
      runtimeConfig.targets.local.authorizeUrl = authorizeUrl;
      const auditTarget = jest.fn(async () => []);
      await createDefaultAdapters(Date.now, { runtimeConfig, audit: { auditTarget }, fetchImpl, env })
        .audit({ targets: ['local'], deadlineAt: Date.now() + 5_000, phase: 'initial' });
      return auditTarget.mock.calls[0][0].targetConfig.runtime;
    };

    test('is sent when the Authorize URL is this environment\'s own Management API', async () => {
      const runtime = await runtimeFor('https://api.pingone.com/v1/environments/env-1/decisionEndpoints', tokenFetch());
      expect(runtime.headers).toEqual({ Authorization: 'Bearer mgmt-token' });
    });

    test('is never requested or sent for any other host or environment', async () => {
      for (const url of ['https://evil.example/v1/environments/env-1/decisionEndpoints',
        'https://api.pingone.com/v1/environments/env-2/decisionEndpoints',
        'https://api.pingone.com/v1/environments/env-1-other/decisionEndpoints']) {
        const fetchImpl = tokenFetch();
        expect(await runtimeFor(url, fetchImpl)).not.toHaveProperty('headers');
        expect(fetchImpl).not.toHaveBeenCalled();
      }
    });
  });

  test('the local audit receives the Gateway Exchange #3 expectation the env generator would write', async () => {
    const auditTarget = jest.fn(async () => []);
    const adapters = createDefaultAdapters(Date.now, {
      runtimeConfig: configuredRuntime(),
      audit: { auditTarget },
      fetchImpl: jest.fn(),
      env: {
        PF_ISSUER: 'https://pf.example.test:9031',
        // Docker-alias host: the generator rewrites it to the issuer's authority.
        PF_TOKEN_ENDPOINT: 'https://pingfederate:9031/as/token.oauth2',
        PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID: 'exchanger',
        PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET: 'exchanger-secret',
      },
    });

    await adapters.audit({ targets: ['local'], deadlineAt: Date.now() + 5_000, phase: 'initial' });

    expect(auditTarget.mock.calls[0][0].targetConfig.gateway).toEqual({ expected: {
      issuer: 'https://pf.example.test:9031',
      tokenEndpoint: 'https://pf.example.test:9031/as/token.oauth2',
      clientId: 'exchanger',
      provenanceContains: 'ping-gateway',
    } });
    expect(JSON.stringify(auditTarget.mock.calls)).not.toContain('exchanger-secret');
  });

  test('the local audit gets no Gateway expectation when the PingFederate settings are unusable', async () => {
    const auditTarget = jest.fn(async () => []);
    const adapters = createDefaultAdapters(Date.now, {
      runtimeConfig: configuredRuntime(), audit: { auditTarget }, fetchImpl: jest.fn(),
      env: { PF_ISSUER: 'not a url' },
    });

    await adapters.audit({ targets: ['local'], deadlineAt: Date.now() + 5_000, phase: 'initial' });

    expect(auditTarget.mock.calls[0][0].targetConfig.gateway).toEqual({ expected: undefined });
  });

  test('worker context cleanup failure blocks its matrix row without changing manifest coverage', async () => {
    const manifestRow = {
      kind: 'core', caseRow: { id: 'UC40', sourceRef: 'demo steps' }, targetId: 'local',
      provider: 'pingone', vertical: 'banking', behavior: { variant: 'normal' },
    };
    const execution = {
      runManifest: jest.fn(async () => ({
        manifest: { core: [manifestRow], variants: [], feature: [], attackLab: [] },
        results: [{ status: 'pass', expected: 'PERMIT', observed: 'PERMIT', evidence: {} }],
        categoryCounts: { total: 1 }, timing: { targetMet: true }, report: {
          ready: true, status: 'ready', checks: [{ id: 'core:UC40:local:pingone:normal', target: 'local', userSessionProvider: 'pingone', status: 'pass' }],
        },
      })),
      dispose: jest.fn(async () => ({ status: 'fail', failures: [{ targetId: 'local', provider: 'pingone' }] })),
    };
    const adapters = createDefaultAdapters(Date.now, { execution, runtimeConfig: configuredRuntime() });

    const result = await adapters.execute({ targets: ['local'], deadlineAt: Date.now() + 5_000, startedAt: Date.now() });

    expect(execution.dispose).toHaveBeenCalledTimes(1);
    expect(result.expectedRowIds).toEqual(['core:UC40:local:pingone:normal']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ status: 'blocked', observed: 'context-cleanup-failed' });
    expect(result.executionReport).toMatchObject({ ready: false, status: 'not-ready' });
    expect(result.executionReport.checks[0]).toMatchObject({ status: 'blocked' });

    const unknownFailureExecution = {
      ...execution,
      dispose: jest.fn(async () => ({ status: 'fail', failures: [{ targetId: 'untracked-target', provider: 'pingone' }] })),
    };
    const unknownFailure = await createDefaultAdapters(Date.now, {
      execution: unknownFailureExecution,
      runtimeConfig: configuredRuntime(),
    }).execute({ targets: ['local'], deadlineAt: Date.now() + 5_000, startedAt: Date.now() });
    expect(unknownFailure.rows[0]).toMatchObject({ status: 'blocked', observed: 'context-cleanup-failed' });
  });

  test('scenario timeout drains bounded cleanup and retains the completed manifest inventory', async () => {
    const { adapters } = harness({
      audit: async () => [{ id: 'config', status: 'pass' }],
      planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 550));
        return { rows: [{ id: 'required', status: 'not-run' }], expectedRowIds: ['required'], categoryCounts: { total: 1 } };
      },
    });

    const result = await startReadinessRun({ targets: ['local', 'se'], adapters, deadlineMs: 500 });

    expect(result.status).toBe('deadline-exceeded');
    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'required', status: 'not-run' }));
    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'run:deadline', status: 'not-run' }));
  });

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

  test('an explicit nonrequired Authorize readback waiver stays visible and does not block a passing matrix', async () => {
    const waiver = 'Temporary waiver: live Authorize policy-tree parity is unverified.';
    const { adapters } = harness({
      audit: async () => [
        { id: 'config', status: 'pass' },
        { id: 'pingone:policyReadback', status: 'blocked', required: false, waiver, evidence: 'Complete policy tree is not available.' },
      ],
      planRepairs: async () => ({ digest: 'empty', changes: [], blocked: [] }),
    });

    const result = await startReadinessRun({ targets: ['local', 'se'], adapters });

    expect(result.status).toBe('ready');
    expect(result.checks.filter((row) => row.id === 'pingone:policyReadback')).toHaveLength(2);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pingone:policyReadback', status: 'blocked', required: false, waiver }),
    ]));
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
