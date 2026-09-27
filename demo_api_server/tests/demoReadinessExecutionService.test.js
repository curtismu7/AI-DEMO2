'use strict';

const { createReadinessExecutionService } = require('../services/demoReadinessExecutionService');

const CASE = {
  id: 'UC6',
  expectedBehaviorByVertical: {
    banking: { kind: 'agent-outcome', expectedOutcome: 'DENY', triggerText: 'deny this' },
  },
  authorizationContractByVertical: {
    banking: {
      primaryTool: 'get_account_balance',
      requiredScopes: ['read'],
      scopeResources: [{ scope: 'read', audience: 'https://gateway.example' }],
      authorizeToolGroup: { role: 'standard', groupName: 'Standard' },
    },
  },
  runtimePrerequisitesByVertical: {
    banking: { requiredFlags: [], a2aCredentials: false, parConfig: false, groupRequirement: null },
  },
  providerFlows: { pingone: 'pingone-standard', pingfederate: 'pingfederate-standard' },
};

function worker(overrides = {}) {
  return {
    provider: 'pingone',
    isolated: true,
    async verifyPrerequisites() { return { status: 'pass' }; },
    async executeReadinessCase() {
      return {
        observed: 'DENY',
        evidence: {
          subject: 'user-1', actor: 'agent-1', audiences: ['https://gateway.example'], scopes: ['read'],
          selectedTool: 'get_account_balance', exchangeProvenance: 'pingone-standard',
          gateway: { route: 'gateway', verdict: 'DENY' }, authorize: { decision: 'DENY', reference: 'p1az-1' },
        },
      };
    },
    ...overrides,
  };
}

describe('demo readiness execution service', () => {
  test('uses a provider-bound worker, verifies prerequisites, and records redacted authorization evidence', async () => {
    const createWorker = jest.fn(async () => worker());
    const service = createReadinessExecutionService({ createWorker, catalog: [CASE] });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1', deadlineAt: Date.now() + 1000 });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking', mode: 'agent-chip', deadlineAt: Date.now() + 1000 });

    expect(createWorker).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' }));
    expect(result).toMatchObject({ status: 'pass', expected: 'DENY', observed: 'DENY' });
    expect(result.evidence).toMatchObject({ userSessionProvider: 'pingone', agentIdentityProvider: 'pingone', tokenIssuer: 'pingone', selectedTool: 'get_account_balance' });
    expect(JSON.stringify(result)).not.toContain('bearer');
  });

  test('fails closed when a worker is not explicitly provider-bound and leaves the active provider untouched', async () => {
    const activeProvider = 'pingone';
    const service = createReadinessExecutionService({ createWorker: async () => ({ provider: 'pingfederate', isolated: false }) });
    await expect(service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'pf-worker' }))
      .rejects.toThrow(/provider isolation/i);
    expect(activeProvider).toBe('pingone');
  });

  test('blocks a row before dispatch when prerequisites are unavailable', async () => {
    const executeReadinessCase = jest.fn();
    const service = createReadinessExecutionService({ createWorker: async () => worker({ verifyPrerequisites: async () => ({ status: 'blocked', reason: 'credentials missing' }), executeReadinessCase }) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking', mode: 'agent-chip' });
    expect(result).toMatchObject({ status: 'blocked', expected: 'DENY', observed: 'not-dispatched' });
    expect(executeReadinessCase).not.toHaveBeenCalled();
  });

  test('fails mismatched outcome, provenance, and authorization evidence', async () => {
    const service = createReadinessExecutionService({ createWorker: async () => worker({
      executeReadinessCase: async () => ({ observed: 'PERMIT', evidence: { tokenIssuer: 'pingfederate', audiences: ['wrong'], scopes: ['write'], gateway: { verdict: 'PERMIT' }, authorize: { decision: 'PERMIT' } } }),
    }) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking', mode: 'agent-chip' });
    expect(result.status).toBe('fail');
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/outcome|issuer|audience|scope|Gateway|Authorize/i)]));
  });

  test('derives the committed core, variant, and attack-lab row counts without dropping UC40', () => {
    const catalog = [
      { ...CASE, id: 'UC6', runtimeVerticalGroups: [{ verticals: ['banking'] }], alternateBehaviors: [] },
      { ...CASE, id: 'UC40', providerFlows: { pingone: null, pingfederate: 'pingfederate-native-id-jag' }, runtimeVerticalGroups: [{ verticals: ['banking'] }], alternateBehaviors: [] },
    ];
    const service = createReadinessExecutionService({ catalog, featureChecks: [
      { id: 'A2A-FM1', providers: ['pingone', 'pingfederate'] },
      { id: 'PF-DAVINCI-IK', providers: ['pingfederate'] },
      { id: 'PRIV-TOOL-ABUSE', providers: ['pingone', 'pingfederate'], attackLab: true },
    ] });
    expect(service.deriveExecutionManifest({ targets: ['local', 'hosted'] }).counts).toEqual({ core: 6, variants: 0, feature: 6, attackLab: 4, total: 16 });
  });

  test('derives the full current inventory: 182 unexpanded, 184 groups, and 772 rows with attack probes', () => {
    const { buildDemoReadinessCatalog } = require('../services/demoReadinessCatalog');
    const catalog = buildDemoReadinessCatalog();
    const unexpanded = catalog.reduce((count, row) => count + (row.providerFlows.pingone ? 2 : 0) + (row.providerFlows.pingfederate ? 2 : 0), 0);
    expect(unexpanded).toBe(182);
    expect(catalog.reduce((count, row) => count + row.runtimeVerticalGroups.length, 0)).toBe(184);
    expect(createReadinessExecutionService({ catalog }).deriveExecutionManifest().counts)
      .toEqual({ core: 734, variants: 4, feature: 14, attackLab: 20, total: 772 });
  });
});
