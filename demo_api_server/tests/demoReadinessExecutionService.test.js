'use strict';

const { createReadinessExecutionService, expectedExchangePath } = require('../services/demoReadinessExecutionService');

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
    runtimeId: 'runtime-pingone', cookieJarId: 'cookies-pingone', sessionStoreId: 'sessions-pingone',
    async verifyPrerequisites() { return { status: 'pass' }; },
    async executeReadinessCase() {
      return {
        observed: 'DENY',
        evidence: {
          userSessionProvider: 'pingone', agentIdentityProvider: 'pingone', tokenIssuer: 'pingone',
          subject: 'user-1', actor: 'agent-1', actorChain: ['agent-1'], roleApplicability: { user: 'required' },
          resourceServer: 'gateway', exchangeService: 'token-exchange', exchangePath: 'standard-access-token', subjectTokenType: 'access_token',
          audiences: ['https://gateway.example'], scopes: ['read'], selectedTool: 'get_account_balance', exchangeProvenance: 'pingone-standard',
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

  test('derives the full current inventory: 182 unexpanded, 184 groups, and 800 rows with required feature probes', () => {
    const { buildDemoReadinessCatalog } = require('../services/demoReadinessCatalog');
    const catalog = buildDemoReadinessCatalog();
    const unexpanded = catalog.reduce((count, row) => count + (row.providerFlows.pingone ? 2 : 0) + (row.providerFlows.pingfederate ? 2 : 0), 0);
    expect(unexpanded).toBe(182);
    expect(catalog.reduce((count, row) => count + row.runtimeVerticalGroups.length, 0)).toBe(184);
    expect(createReadinessExecutionService({ catalog }).deriveExecutionManifest().counts)
      .toEqual({ core: 734, variants: 4, feature: 42, attackLab: 20, total: 800 });
  });

  test('executes every manifest category, preserves UC14b full-page behavior, and records report rows', async () => {
    const variantCase = {
      ...CASE,
      id: 'UC14b',
      runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }],
      alternateBehaviors: [{ kind: 'page-load', pathname: '/intent-binding', path: '/intent-binding', variant: 'full-page-live-par' }],
    };
    const seen = [];
    const service = createReadinessExecutionService({
      catalog: [variantCase],
      featureChecks: [{ id: 'FEATURE', providers: ['pingone'], expectedOutcome: 'FEATURE_PASS', executionMode: 'feature' }],
      createWorker: async () => worker({
        async executeReadinessCase(input) { seen.push(input.behavior); return { observed: input.behavior.kind === 'page-load' ? 'page-load' : 'DENY', evidence: worker().executeReadinessCase ? (await worker().executeReadinessCase()).evidence : {} }; },
        async executeReadinessFeature() { return { observed: 'FEATURE_PASS', evidence: { userSessionProvider: 'pingone', agentIdentityProvider: 'pingone', tokenIssuer: 'pingone', subject: 'user-1', actorChain: ['agent-1'], exchangeService: 'feature', exchangeProvenance: 'feature', exchangePath: 'standard-access-token', subjectTokenType: 'access_token', resourceServer: 'feature', roleApplicability: { user: 'required' }, gateway: { applicable: false }, authorize: { applicable: false } } }; },
      }),
    });
    const run = await service.runManifest({ targets: ['local'] });
    expect(run.results).toHaveLength(run.manifest.counts.total);
    expect(seen).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'page-load', variant: 'full-page-live-par' })]));
    expect(run.report.checks).toHaveLength(run.manifest.counts.total);
    expect(run.categoryCounts).toEqual(run.manifest.counts);
  });

  test('requires observed provider roles, subject/actor chain, exchange, resource, and authorization evidence', async () => {
    const service = createReadinessExecutionService({ createWorker: async () => worker({
      async executeReadinessCase() { return { observed: 'DENY', evidence: { audiences: ['https://gateway.example'], scopes: ['read'], selectedTool: 'get_account_balance', gateway: { route: 'gateway', verdict: 'DENY' }, authorize: { decision: 'DENY', reference: 'p1az' } } }; },
    }) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1' });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking' });
    expect(result.status).toBe('fail');
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/user-session provider|subject|actor chain|exchange service|role applicability/i)]));
  });

  test('marks every unstarted row not-run when the hard deadline expires and reports the timing gate', async () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValue(900001);
    const service = createReadinessExecutionService({ catalog: [{ ...CASE, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }], alternateBehaviors: [] }], featureChecks: [], createWorker: jest.fn(), now });
    const run = await service.runManifest({ targets: ['local'], startedAt: 0, deadlineAt: 900000 });
    expect(run.results).toHaveLength(run.manifest.counts.total);
    expect(run.results.filter((row) => row.status === 'not-run')).toHaveLength(run.manifest.counts.total - 1);
    expect(run.results[0].status).toBe('blocked');
    expect(run.timing).toMatchObject({ deadlineExceeded: true, targetMet: false, hardLimitMs: 900000, targetMs: 720000 });
  });

  test('keeps ordinary, A2A, native ID-JAG, and actor-bound PF provenance distinct', () => {
    expect(expectedExchangePath({ id: 'UC6' }, 'pingfederate')).toBe('standard-access-token');
    expect(expectedExchangePath({ id: 'UC2.5' }, 'pingfederate')).toBe('a2a-id-jag-then-access');
    expect(expectedExchangePath({ id: 'UC40' }, 'pingfederate')).toBe('native-id-jag');
    expect(expectedExchangePath({ id: 'UC38' }, 'pingfederate')).toBe('actor-bound-standard-two-exchange');
    expect(expectedExchangePath({ id: 'UC44' }, 'pingone')).toBe('actor-bound-standard-two-exchange');
  });

  test('fails a PF exchange with an incomplete endpoint, wrong token type, or no registered tool result', async () => {
    const pfCase = { ...CASE, providerFlows: { pingone: null, pingfederate: 'pingfederate-standard' } };
    const service = createReadinessExecutionService({ createWorker: async () => ({
      ...worker(), provider: 'pingfederate', runtimeId: 'pf-runtime', cookieJarId: 'pf-cookies', sessionStoreId: 'pf-sessions',
      async executeReadinessCase() { return { observed: 'DENY', evidence: { ...(await worker().executeReadinessCase()).evidence, userSessionProvider: 'pingfederate', tokenIssuer: 'pingfederate', agentIdentityProvider: 'pingfederate', exchangeProvenance: 'pingfederate-standard', pfExchange: { issuer: 'http://pf.example', endpoint: 'https://other.example/token', credentialRef: '', configurationComplete: false, subjectTokenType: 'id-jag', registeredToolResult: 'fail' } } }; },
    }) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'pf' });
    const result = await service.executeReadinessCase({ context, caseRow: pfCase, vertical: 'banking' });
    expect(result.status).toBe('fail');
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/PF endpoint|credential|configuration|subject-token|registered-tool/i)]));
  });
});
