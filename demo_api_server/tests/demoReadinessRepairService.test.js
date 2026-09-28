'use strict';

const { createRepairService } = require('../services/demoReadinessRepairService');

const NOW = 1_790_000_000_000;
const TARGETS = [{ id: 'local', kind: 'local' }];
const ADMIN_ASSERTION = { token: 'verified-admin-assertion' };

function finding(overrides = {}) {
  return {
    id: 'pingone:scope',
    status: 'fail',
    target: 'local',
    repairCandidates: [{
      repairClass: 'pingone-scope-addition',
      target: 'local',
      object: { id: 'resource-1', kind: 'resource-scope' },
      current: ['read'],
      expected: ['read', 'write'],
      sourceRef: 'scope-topology.json#resources/resource-1/scopes',
      operation: 'Create the uniquely mapped missing scope write',
    }],
    ...overrides,
  };
}

function repairService(overrides = {}) {
  const current = overrides.current || ['read'];
  const adapter = overrides.adapter || {
    read: jest.fn(async () => current),
    write: jest.fn(async () => undefined),
    readback: jest.fn(async () => ['read', 'write']),
  };
  return {
    adapter,
    service: createRepairService({
      now: () => NOW,
      adapters: { 'pingone-scope-addition': adapter },
      verifyAdminConfirmation: jest.fn(async (assertion) => assertion === ADMIN_ASSERTION ? { subject: 'admin-1' } : null),
      ...overrides.service,
      sourceReaders: { pingoneScopeTopology: jest.fn(() => ({
        target: 'local', object: { id: 'resource-1', kind: 'resource-scope' }, expected: ['read', 'write'],
        sourceRef: 'scope-topology.json#resources/resource-1/scopes', operation: 'Create the uniquely mapped missing scope write',
      })), ...overrides.service?.sourceReaders },
    }),
  };
}

describe('demo readiness repair service', () => {
  test('previews exact source-backed values and changes the digest when a field changes', () => {
    const { service } = repairService();
    const first = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });
    const second = service.planRepairs({ findings: [finding({ repairCandidates: [{ ...finding().repairCandidates[0], expected: ['read', 'admin'] }] })], targets: TARGETS, now: NOW });

    expect(first.changes).toEqual([expect.objectContaining({
      target: 'local', object: { id: 'resource-1', kind: 'resource-scope' },
      current: ['read'], expected: ['read', 'write'],
      sourceRef: 'scope-topology.json#resources/resource-1/scopes',
      operation: 'Create the uniquely mapped missing scope write',
    })]);
    expect(first.digest).not.toBe(second.digest);
  });

  test.each([
    ['changed target set', ({ plan }) => ({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: [{ id: 'se', kind: 'se' }], now: NOW })],
    ['expired plan', ({ plan }) => ({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: plan.expiresAt })],
  ])('%s stops before the first write', async (_name, applyArgs) => {
    const { service, adapter } = repairService();
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs(applyArgs({ plan }))).rejects.toThrow(/target set|expired/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test.each([
    ['aborted signal', ({ controller }) => ({ signal: controller.signal, deadlineAt: NOW + 1_000 })],
    ['expired deadline', ({ controller }) => ({ signal: controller.signal, deadlineAt: NOW })],
  ])('cancellation %s before the first write prevents mutation', async (_label, cancellationArgs) => {
    const { service, adapter } = repairService();
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });
    const controller = new AbortController();
    if (_label === 'aborted signal') controller.abort();
    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW, ...cancellationArgs({ controller }) }))
      .rejects.toThrow(/abort|deadline|expir/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('abort during a write waits for it to settle and prevents subsequent writes', async () => {
    let startWrite;
    let releaseWrite;
    const writeStarted = new Promise((resolve) => { startWrite = resolve; });
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const adapter = {
      read: jest.fn(async () => ['read']),
      write: jest.fn(async () => { startWrite(); await writeGate; }),
      readback: jest.fn(async () => ['read', 'write']),
    };
    const sourceReaders = {
      pingoneScopeTopology: jest.fn(({ objectId }) => ({
        target: 'local', object: { id: objectId, kind: 'resource-scope' }, expected: ['read', 'write'],
        sourceRef: 'scope-topology.json#resources/' + objectId + '/scopes', operation: 'Create the uniquely mapped missing scope write',
      })),
    };
    const service = createRepairService({ now: () => NOW, adapters: { 'pingone-scope-addition': adapter }, sourceReaders, verifyAdminConfirmation: async () => ({ subject: 'admin-1' }) });
    const first = finding().repairCandidates[0];
    const second = { ...first, object: { id: 'resource-2', kind: 'resource-scope' }, sourceRef: 'scope-topology.json#resources/resource-2/scopes' };
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [first, second] })], targets: TARGETS, now: NOW });
    const controller = new AbortController();
    let settled = false;
    const applying = service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW, deadlineAt: NOW + 1_000, signal: controller.signal }).finally(() => { settled = true; });

    await writeStarted;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseWrite();
    const failure = await applying.catch((error) => error);
    expect(failure.message).toMatch(/abort|deadline|expir/i);
    expect(failure.repairEvidence[0].after).toEqual(['read', 'write']);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.readback).toHaveBeenCalledTimes(1);
  });

  test('deadline cancellation does not prevent isolated worker restoration and readback', async () => {
    let clockNow = NOW;
    let startWrite;
    let releaseWrite;
    const writeStarted = new Promise((resolve) => { startWrite = resolve; });
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const worker = {};
    let enabled = false;
    const adapter = {
      createIsolatedWorker: jest.fn(async () => worker),
      read: jest.fn(async () => enabled),
      write: jest.fn(async () => { startWrite(); await writeGate; enabled = true; }),
      readback: jest.fn(async () => enabled),
      restore: jest.fn(async () => { enabled = false; }),
    };
    const sourceReaders = {
      readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })),
    };
    const service = createRepairService({ now: () => clockNow, adapters: { 'demo-feature-flag': adapter }, sourceReaders, verifyAdminConfirmation: async () => ({ subject: 'admin-1' }) });
    const candidate = {
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' }, current: false, expected: true,
      sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
    };
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [candidate] })], targets: TARGETS, now: NOW });
    const deadlineAt = NOW + 1_000;
    const controller = new AbortController();
    const applying = service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW, deadlineAt, signal: controller.signal });

    await writeStarted;
    clockNow = deadlineAt;
    controller.abort();
    releaseWrite();

    await expect(applying).rejects.toThrow(/abort|deadline|expir/i);
    expect(adapter.restore).toHaveBeenCalledTimes(1);
    expect(adapter.restore.mock.calls[0][0]).not.toHaveProperty('signal');
    expect(adapter.restore.mock.calls[0][0]).not.toHaveProperty('deadlineAt');
    expect(adapter.read).toHaveBeenCalledTimes(2);
    expect(adapter.read.mock.calls[1][0]).not.toHaveProperty('signal');
    expect(adapter.read.mock.calls[1][0]).not.toHaveProperty('deadlineAt');
    expect(enabled).toBe(false);
  });

  test('cancellation during isolated-worker setup retains its context for cleanup', async () => {
    let clockNow = NOW;
    let startSetup;
    let releaseSetup;
    const setupStarted = new Promise((resolve) => { startSetup = resolve; });
    const setupGate = new Promise((resolve) => { releaseSetup = resolve; });
    const worker = {};
    const adapter = {
      createIsolatedWorker: jest.fn(async () => { startSetup(); await setupGate; return worker; }),
      read: jest.fn(async () => false),
      write: jest.fn(),
      readback: jest.fn(),
      restore: jest.fn(async () => undefined),
    };
    const sourceReaders = {
      readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })),
    };
    const service = createRepairService({ now: () => clockNow, adapters: { 'demo-feature-flag': adapter }, sourceReaders, verifyAdminConfirmation: async () => ({ subject: 'admin-1' }) });
    const candidate = {
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' }, current: false, expected: true,
      sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
    };
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [candidate] })], targets: TARGETS, now: NOW });
    const deadlineAt = NOW + 1_000;
    const controller = new AbortController();
    const applying = service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW, deadlineAt, signal: controller.signal });

    await setupStarted;
    clockNow = deadlineAt;
    controller.abort();
    releaseSetup();

    await expect(applying).rejects.toThrow(/abort|deadline|expir/i);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ expected: false, workerContext: worker }));
    expect(adapter.restore.mock.calls[0][0]).not.toHaveProperty('signal');
    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(adapter.read.mock.calls[0][0]).not.toHaveProperty('signal');
  });

  test('an altered current value or ambiguous object stops before the first write', async () => {
    const changed = repairService({ current: ['admin'] });
    const changedPlan = changed.service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });
    await expect(changed.service.applyRepairs({ digest: changedPlan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW }))
      .rejects.toThrow(/current value changed/i);
    expect(changed.adapter.write).not.toHaveBeenCalled();

    const ambiguous = repairService();
    const ambiguousPlan = ambiguous.service.planRepairs({ findings: [finding({ repairCandidates: [{ ...finding().repairCandidates[0], object: { id: 'resource-1', ambiguous: true } }] })], targets: TARGETS, now: NOW });
    expect(ambiguousPlan.changes).toEqual([]);
    expect(ambiguousPlan.blocked).toEqual([expect.objectContaining({ reason: expect.stringMatching(/ambiguous/i) })]);
    expect(ambiguous.adapter.write).not.toHaveBeenCalled();
  });

  test('applies a confirmed repair once, reads it back, and records sanitized evidence', async () => {
    const { service, adapter } = repairService();
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });

    const result = await service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW });

    expect(result.evidence).toEqual([expect.objectContaining({ before: ['read'], after: ['read', 'write'] })]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.readback).toHaveBeenCalledTimes(1);
    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW }))
      .rejects.toThrow(/already confirmed/i);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  test('is safe to retry after a timeout when readback already has the expected value', async () => {
    const adapter = {
      read: jest.fn()
        .mockResolvedValueOnce(['read'])
        .mockResolvedValueOnce(['read', 'write']),
      write: jest.fn(async () => { throw new Error('request timed out after the provider accepted it'); }),
      readback: jest.fn(async () => ['read', 'write']),
    };
    const { service } = repairService({ adapter });
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });
    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW })).rejects.toThrow(/timed out/i);

    const retried = await service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW });
    expect(retried.evidence).toEqual([expect.objectContaining({ outcome: 'already-applied' })]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  test('keeps feature flags in the isolated worker and restores them after the case', async () => {
    const worker = {};
    const adapter = {
      createIsolatedWorker: jest.fn(async () => worker),
      read: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      write: jest.fn(async () => undefined),
      readback: jest.fn(async () => true),
      restore: jest.fn(async () => undefined),
    };
    const service = createRepairService({
      now: () => NOW, verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })) }, adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' },
      current: false, expected: true, sourceRef: 'demo_api_server/config/useCases.js#UC1',
      operation: 'Enable only for the isolated readiness worker',
    }] })], targets: TARGETS, now: NOW });

    await service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW });
    expect(adapter.write).toHaveBeenCalledWith(expect.objectContaining({ workerContext: worker }));
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ expected: false, workerContext: worker }));
  });

  test('restores an isolated feature flag after a write error without touching presenter state', async () => {
    const worker = {};
    const adapter = {
      createIsolatedWorker: jest.fn(async () => worker),
      read: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      write: jest.fn(async () => { throw new Error('worker stopped'); }),
      readback: jest.fn(), restore: jest.fn(async () => undefined),
    };
    const presenter = { ff_demo: false };
    const service = createRepairService({
      now: () => NOW, verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })) }, adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' },
      current: false, expected: true, sourceRef: 'demo_api_server/config/useCases.js#UC1',
      operation: 'Enable only for the isolated readiness worker',
    }] })], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW })).rejects.toThrow(/worker stopped/i);
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ expected: false, workerContext: worker }));
    expect(presenter.ff_demo).toBe(false);
  });

  test('keeps unsupported Authorize writes blocked and never calls a mutation adapter', async () => {
    const write = jest.fn();
    const service = createRepairService({ now: () => NOW, adapters: { 'authorize-policy-definition': { read: jest.fn(), write } } });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'authorize-policy-definition', target: 'local', object: { id: 'policy-1' }, current: 'old', expected: 'new', sourceRef: 'policy', operation: 'write policy',
    }] })], targets: TARGETS, now: NOW });

    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toEqual([expect.objectContaining({ repairMode: 'manual' })]);
    expect(write).not.toHaveBeenCalled();
  });

  test('rejects caller text that has not been verified as an administrator assertion', async () => {
    const { service, adapter } = repairService({
      service: { verifyAdminConfirmation: jest.fn(async () => null) },
    });
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin@example.test', targets: TARGETS, now: NOW }))
      .rejects.toThrow(/verified administrator/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('derives automatic preview values from the trusted declared source contract', () => {
    const contract = {
      target: 'local', object: { id: 'resource-1', kind: 'pingone-resource-scopes' },
      expected: ['read', 'write'], sourceRef: 'scope-topology.json#resources/resource-1/scopes',
      operation: 'Create only the declared missing PingOne resource scope',
    };
    const { service } = repairService({ service: {
      sourceReaders: { pingoneScopeTopology: jest.fn(() => contract) },
    } });
    const malicious = finding({ repairCandidates: [{
      ...finding().repairCandidates[0], sourceRef: 'attacker-controlled-source',
      object: { id: 'different-resource', kind: 'pingone-resource-scopes' }, expected: ['admin:delete'],
    }] });

    const plan = service.planRepairs({ findings: [malicious], targets: TARGETS, now: NOW });
    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toEqual([expect.objectContaining({ reason: expect.stringMatching(/declared source/i) })]);
  });

  test('does not accept a caller label as an isolated feature-flag worker', () => {
    const adapter = { read: jest.fn(), write: jest.fn(), readback: jest.fn(), restore: jest.fn() };
    const service = createRepairService({
      now: () => NOW,
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })) },
      adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' }, current: false, expected: true,
      sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker', worker: 'isolated-readiness-worker',
    }] })], targets: TARGETS, now: NOW });

    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toEqual([expect.objectContaining({ reason: expect.stringMatching(/trusted isolated worker/i) })]);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('restores and verifies an already-armed isolated feature flag on retry', async () => {
    const worker = {};
    const adapter = {
      createIsolatedWorker: jest.fn(async () => worker),
      read: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      write: jest.fn(), readback: jest.fn(), restore: jest.fn(async () => undefined),
    };
    const service = createRepairService({
      now: () => NOW,
      verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })) },
      adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' }, current: false, expected: true,
    }] })], targets: TARGETS, now: NOW });

    const result = await service.applyRepairs({ digest: plan.digest, confirmedBy: { assertion: 'trusted' }, targets: TARGETS, now: NOW });
    expect(result.evidence).toEqual([expect.objectContaining({ outcome: 'already-applied', restored: false })]);
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ workerContext: worker, expected: false }));
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('restores an isolated feature flag when its initial worker read fails', async () => {
    const worker = {};
    const adapter = {
      createIsolatedWorker: jest.fn(async () => worker),
      read: jest.fn().mockRejectedValueOnce(new Error('worker read failed')).mockResolvedValueOnce(false),
      write: jest.fn(), readback: jest.fn(), restore: jest.fn(async () => undefined),
    };
    const service = createRepairService({
      now: () => NOW, verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_demo' }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Enable only for the isolated readiness worker',
      })) }, adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' }, current: false, expected: true,
    }] })], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW })).rejects.toThrow(/worker read failed/i);
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ expected: false, workerContext: worker }));
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('attaches an actionable operator instruction to malformed manual candidates', () => {
    const { service } = repairService();
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'authorize-policy-definition', target: 'local', object: { ambiguous: true }, current: 'old', expected: 'new',
    }] })], targets: TARGETS, now: NOW });

    expect(plan.blocked).toEqual([expect.objectContaining({ repairMode: 'manual', operatorAction: expect.stringMatching(/block READY/i) })]);
  });

  test('continues isolated-worker cleanup after an earlier cleanup failure', async () => {
    const firstWorker = {}; const secondWorker = {};
    const adapter = {
      createIsolatedWorker: jest.fn().mockResolvedValueOnce(firstWorker).mockResolvedValueOnce(secondWorker),
      read: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      write: jest.fn(), readback: jest.fn(),
      restore: jest.fn().mockRejectedValueOnce(new Error('second worker restore failed')).mockResolvedValueOnce(undefined),
    };
    const service = createRepairService({
      now: () => NOW, verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: { readinessWorkerFlag: jest.fn(({ objectId }) => ({
        target: 'local', object: { id: objectId }, expected: true,
        sourceRef: 'demo_api_server/config/useCases.js#' + objectId, operation: 'Enable only for the isolated readiness worker',
      })) }, adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: ['ff_one', 'ff_two'].map((id) => ({
      repairClass: 'demo-feature-flag', target: 'local', object: { id }, current: false, expected: true,
    })) })], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW }))
      .rejects.toThrow(/isolated worker cleanup failed/i);
    expect(adapter.restore).toHaveBeenCalledTimes(2);
    expect(adapter.restore).toHaveBeenLastCalledWith(expect.objectContaining({ workerContext: firstWorker, expected: false }));
    expect(adapter.read).toHaveBeenLastCalledWith(expect.objectContaining({ workerContext: firstWorker }));
    expect(adapter.read.mock.calls.filter(([args]) => args.workerContext === secondWorker)).toHaveLength(2);
    expect(adapter.read.mock.calls.filter(([args]) => args.workerContext === firstWorker)).toHaveLength(2);
  });

  test('plans a legitimate false source-contract expectation', () => {
    const adapter = { createIsolatedWorker: jest.fn(), read: jest.fn(), write: jest.fn(), readback: jest.fn(), restore: jest.fn() };
    const service = createRepairService({
      now: () => NOW,
      sourceReaders: { readinessWorkerFlag: jest.fn(() => ({
        target: 'local', object: { id: 'ff_disabled' }, expected: false,
        sourceRef: 'demo_api_server/config/useCases.js#UC1', operation: 'Disable only for the isolated readiness worker',
      })) },
      adapters: { 'demo-feature-flag': adapter },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_disabled' }, current: true, expected: false,
    }] })], targets: TARGETS, now: NOW });

    expect(plan.changes).toEqual([expect.objectContaining({ expected: false, object: { id: 'ff_disabled' } })]);
  });

  test('aggregates cleanup failures without hiding the original apply error', async () => {
    const firstWorker = {}; const secondWorker = {};
    const flagAdapter = {
      createIsolatedWorker: jest.fn().mockResolvedValueOnce(firstWorker).mockResolvedValueOnce(secondWorker),
      read: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      write: jest.fn(), readback: jest.fn(),
      restore: jest.fn().mockRejectedValueOnce(new Error('second cleanup failed')).mockResolvedValueOnce(undefined),
    };
    const service = createRepairService({
      now: () => NOW, verifyAdminConfirmation: jest.fn(async () => ({ subject: 'admin-1' })),
      sourceReaders: {
        pingoneScopeTopology: jest.fn(() => ({
          target: 'local', object: { id: 'resource-1', kind: 'resource-scope' }, expected: ['read', 'write'],
          sourceRef: 'scope-topology.json#resources/resource-1/scopes', operation: 'Create the uniquely mapped missing scope write',
        })),
        readinessWorkerFlag: jest.fn(({ objectId }) => ({
          target: 'local', object: { id: objectId }, expected: true,
          sourceRef: 'demo_api_server/config/useCases.js#' + objectId, operation: 'Enable only for the isolated readiness worker',
        })),
      },
      adapters: {
        'pingone-scope-addition': { read: jest.fn(async () => ['read']), write: jest.fn(async () => { throw new Error('provider write failed'); }), readback: jest.fn() },
        'demo-feature-flag': flagAdapter,
      },
    });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [
      finding().repairCandidates[0],
      ...['ff_one', 'ff_two'].map((id) => ({ repairClass: 'demo-feature-flag', target: 'local', object: { id }, current: false, expected: true })),
    ] })], targets: TARGETS, now: NOW });

    let failure;
    try {
      await service.applyRepairs({ digest: plan.digest, confirmedBy: ADMIN_ASSERTION, targets: TARGETS, now: NOW });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.applyError.message).toMatch(/provider write failed/i);
    expect(failure.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/provider write failed/i), expect.stringMatching(/second cleanup failed/i),
    ]));
    expect(flagAdapter.restore).toHaveBeenCalledTimes(2);
  });
});
