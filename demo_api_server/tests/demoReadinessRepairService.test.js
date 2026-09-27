'use strict';

const { createRepairService } = require('../services/demoReadinessRepairService');

const NOW = 1_790_000_000_000;
const TARGETS = [{ id: 'local', kind: 'local' }];

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
      ...overrides.service,
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
    ['changed target set', ({ plan }) => ({ digest: plan.digest, confirmedBy: 'admin', targets: [{ id: 'se', kind: 'se' }], now: NOW })],
    ['expired plan', ({ plan }) => ({ digest: plan.digest, confirmedBy: 'admin', targets: TARGETS, now: plan.expiresAt })],
  ])('%s stops before the first write', async (_name, applyArgs) => {
    const { service, adapter } = repairService();
    const plan = service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs(applyArgs({ plan }))).rejects.toThrow(/target set|expired/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test('an altered current value or ambiguous object stops before the first write', async () => {
    const changed = repairService({ current: ['admin'] });
    const changedPlan = changed.service.planRepairs({ findings: [finding()], targets: TARGETS, now: NOW });
    await expect(changed.service.applyRepairs({ digest: changedPlan.digest, confirmedBy: 'admin', targets: TARGETS, now: NOW }))
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

    const result = await service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin@example.test', targets: TARGETS, now: NOW });

    expect(result.evidence).toEqual([expect.objectContaining({ before: ['read'], after: ['read', 'write'] })]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.readback).toHaveBeenCalledTimes(1);
    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin@example.test', targets: TARGETS, now: NOW }))
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
    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin', targets: TARGETS, now: NOW })).rejects.toThrow(/timed out/i);

    const retried = await service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin', targets: TARGETS, now: NOW });
    expect(retried.evidence).toEqual([expect.objectContaining({ outcome: 'already-applied' })]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  test('keeps feature flags in the isolated worker and restores them after the case', async () => {
    const adapter = {
      read: jest.fn(async () => false),
      write: jest.fn(async () => undefined),
      readback: jest.fn(async () => true),
      restore: jest.fn(async () => undefined),
    };
    const service = createRepairService({ now: () => NOW, adapters: { 'demo-feature-flag': adapter } });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' },
      current: false, expected: true, sourceRef: 'demo_api_server/config/useCases.js#UC1',
      operation: 'Enable only for the isolated readiness worker', worker: 'isolated-readiness-worker',
    }] })], targets: TARGETS, now: NOW });

    await service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin', targets: TARGETS, now: NOW });
    expect(adapter.write).toHaveBeenCalledWith(expect.objectContaining({ worker: 'isolated-readiness-worker' }));
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ current: false, worker: 'isolated-readiness-worker' }));
  });

  test('restores an isolated feature flag after a write error without touching presenter state', async () => {
    const adapter = {
      read: jest.fn(async () => false),
      write: jest.fn(async () => { throw new Error('worker stopped'); }),
      readback: jest.fn(), restore: jest.fn(async () => undefined),
    };
    const presenter = { ff_demo: false };
    const service = createRepairService({ now: () => NOW, adapters: { 'demo-feature-flag': adapter } });
    const plan = service.planRepairs({ findings: [finding({ repairCandidates: [{
      repairClass: 'demo-feature-flag', target: 'local', object: { id: 'ff_demo' },
      current: false, expected: true, sourceRef: 'demo_api_server/config/useCases.js#UC1',
      operation: 'Enable only for the isolated readiness worker', worker: 'isolated-readiness-worker',
    }] })], targets: TARGETS, now: NOW });

    await expect(service.applyRepairs({ digest: plan.digest, confirmedBy: 'admin', targets: TARGETS, now: NOW })).rejects.toThrow(/worker stopped/i);
    expect(adapter.restore).toHaveBeenCalledWith(expect.objectContaining({ current: false, worker: 'isolated-readiness-worker' }));
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
});
