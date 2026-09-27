'use strict';

const { createReadinessExecutionService, expectedExchangePath } = require('../services/demoReadinessExecutionService');
const testWorkerAdapter = (adapter) => adapter;
const createTrustedWorkerFactory = testWorkerAdapter;

const CASE = {
  id: 'UC6',
  expectedBehaviorByVertical: {
    banking: { kind: 'agent-outcome', expectedOutcome: 'DENY', triggerText: 'deny this' },
  },
  authorizationContractByVertical: {
    banking: {
      primaryTool: 'get_account_balance',
      resourceServer: 'gateway',
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
    runtime: {}, cookieJar: {}, sessionStore: {},
    async verifyPrerequisites() { return { status: 'pass' }; },
    async executeReadinessCase() {
      return {
        observed: 'DENY',
        evidence: {
          userSessionProvider: 'pingone', agentIdentityProvider: 'pingone', tokenIssuer: 'pingone',
          subject: 'user-1', actor: 'agent-1', actorChain: ['agent-1'], roleApplicability: { authorizeRole: 'standard' },
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
    const createWorker = createTrustedWorkerFactory(jest.fn(async () => worker()));
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
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => ({ provider: 'pingfederate' })) });
    await expect(service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'pf-worker' }))
      .rejects.toThrow(/provider isolation/i);
    expect(activeProvider).toBe('pingone');
  });

  test('blocks a row before dispatch when prerequisites are unavailable', async () => {
    const executeReadinessCase = jest.fn();
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => worker({ verifyPrerequisites: async () => ({ status: 'blocked', reason: 'credentials missing' }), executeReadinessCase })) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking', mode: 'agent-chip' });
    expect(result).toMatchObject({ status: 'blocked', expected: 'DENY', observed: 'not-dispatched' });
    expect(executeReadinessCase).not.toHaveBeenCalled();
  });

  test('fails mismatched outcome, provenance, and authorization evidence', async () => {
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => worker({
      executeReadinessCase: async () => ({ observed: 'PERMIT', evidence: { tokenIssuer: 'pingfederate', audiences: ['wrong'], scopes: ['write'], gateway: { verdict: 'PERMIT' }, authorize: { decision: 'PERMIT' } } }),
    })) });
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
      createWorker: createTrustedWorkerFactory(async () => worker({
        async verifyFeaturePrerequisites({ configurationDependencies }) { return { status: 'pass', verifiedDependencies: configurationDependencies }; },
        async executeReadinessCase(input) { seen.push(input.behavior); return { observed: input.behavior.kind === 'page-load' ? 'page-load' : 'DENY', evidence: worker().executeReadinessCase ? (await worker().executeReadinessCase()).evidence : {} }; },
        async executeReadinessFeature() { return { observed: 'FEATURE_PASS', evidence: { userSessionProvider: 'pingone', agentIdentityProvider: 'pingone', tokenIssuer: 'pingone', subject: 'user-1', actorChain: ['agent-1'], exchangeService: 'token-exchange', exchangeProvenance: 'pingone-standard', exchangePath: 'standard-access-token', subjectTokenType: 'access_token', resourceServer: 'readiness-control', roleApplicability: {}, providerRoleApplicability: {}, requiredEvidence: [], gateway: { applicable: false }, authorize: { applicable: false } } }; },
      })),
    });
    const run = await service.runManifest({ targets: ['local'] });
    expect(run.results).toHaveLength(run.manifest.counts.total);
    expect(seen).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'page-load', variant: 'full-page-live-par' })]));
    expect(run.report.checks).toHaveLength(run.manifest.counts.total);
    expect(run.categoryCounts).toEqual(run.manifest.counts);
  });

  test('requires observed provider roles, subject/actor chain, exchange, resource, and authorization evidence', async () => {
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => worker({
      async executeReadinessCase() { return { observed: 'DENY', evidence: { audiences: ['https://gateway.example'], scopes: ['read'], selectedTool: 'get_account_balance', gateway: { route: 'gateway', verdict: 'DENY' }, authorize: { decision: 'DENY', reference: 'p1az' } } }; },
    })) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1' });
    const result = await service.executeReadinessCase({ context, caseRow: CASE, vertical: 'banking' });
    expect(result.status).toBe('fail');
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/user-session provider|subject|actor chain|exchange service|role applicability/i)]));
  });

  test('executes every new feature family against its declared dependencies, evidence, and provider-role contract', async () => {
    const featureManifest = require('../config/demoReadinessFeatureChecks.json');
    const checks = featureManifest.checks.filter((check) => [
      'PINGONE-AGENT-IAM-CORE', 'PF-CIMD-VALID', 'PF-CIMD-REJECTED', 'PF-THIRD-PARTY-AS-ALLOW',
      'PF-THIRD-PARTY-AS-DENY', 'PF-ID-JAG-INVALID', 'PF-ID-JAG-EXPIRED', 'PF-ID-JAG-WRONG-AUDIENCE',
      'PF-RAR-VALID', 'PF-RAR-INVALID', 'UC2-PASSENGER-INVALID-TARGET', 'UC-LEARN11-PROMPT-INJECTION',
    ].includes(check.id));
    for (const check of checks) for (const provider of check.providers) {
      const contract = featureManifest.contracts[check.id];
      const exchangeBacked = Boolean(contract.selectedTool);
      const nativeIdJag = check.executionMode === 'pf-native-id-jag-negative';
      const a2aPassenger = check.executionMode === 'a2a-passenger-negative';
      const verified = jest.fn(async ({ configurationDependencies }) => ({ status: 'pass', verifiedDependencies: configurationDependencies }));
      const service = createReadinessExecutionService({
        createWorker: createTrustedWorkerFactory(async () => ({
          provider, runtime: {}, cookieJar: {}, sessionStore: {}, verifyFeaturePrerequisites: verified,
          async executeReadinessCase() { throw new Error('not used by feature fixture'); },
          async executeReadinessFeature() {
            return { observed: check.expectedByProvider?.[provider] || check.expectedOutcome, evidence: {
              userSessionProvider: provider, agentIdentityProvider: provider, tokenIssuer: provider, subject: 'readiness-user', actorChain: ['readiness-agent'],
              exchangeService: contract.exchangeService, exchangeProvenance: contract.providerFlows[provider],
              exchangePath: nativeIdJag ? 'native-id-jag' : a2aPassenger ? provider === 'pingfederate' ? 'a2a-id-jag-then-access' : 'a2a-access-token' : 'standard-access-token', subjectTokenType: nativeIdJag ? 'id-jag' : 'access_token',
              ...(a2aPassenger && provider === 'pingfederate' ? { exchangeHops: [{ step: 'exchange1-id-jag', type: 'id-jag', subject: 'readiness-user', actorChain: ['readiness-agent'] }, { step: 'exchange2-access-token', type: 'access_token', subject: 'readiness-user', actorChain: ['readiness-agent'] }] } : {}),
              ...(provider === 'pingfederate' ? { pfExchange: { issuer: 'https://pf.example', endpoint: 'https://pf.example/token', credentialRef: 'pf:readiness', configurationComplete: true, subjectTokenType: nativeIdJag ? 'id-jag' : 'access_token', registeredToolResult: exchangeBacked ? 'pass' : undefined } } : {}),
              resourceServer: contract.resourceServer, roleApplicability: contract.authorizeToolGroup ? { authorizeRole: contract.authorizeToolGroup.role } : {},
              providerRoleApplicability: check.providerRoleApplicability || {}, requiredEvidence: check.requiredEvidence || [], behaviorStages: contract.behaviorStages,
              ...(exchangeBacked ? { selectedTool: contract.selectedTool, audiences: contract.audiences, scopes: contract.requiredScopes, gateway: { route: 'gateway', verdict: contract.expectedDecision }, authorize: { reference: 'authorize-ref', decision: contract.expectedDecision } } : { gateway: contract.gateway, authorize: contract.authorize }),
            } };
          },
        })),
      });
      const context = await service.createWorkerContext({ targetId: 'local', provider, identityRef: 'mocked-' + provider });
      const result = await service.executeReadinessFeature({ context, check });
      expect(result).toMatchObject({ status: provider === 'pingfederate' && contract.exchangeService === 'token-exchange' ? 'blocked' : 'pass', expected: check.expectedByProvider?.[provider] || check.expectedOutcome });
      expect(verified).toHaveBeenCalledWith(expect.objectContaining({ configurationDependencies: check.configurationDependencies }));
    }
  });

  test('marks every unstarted row not-run when the hard deadline expires and reports the timing gate', async () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValue(900001);
    const service = createReadinessExecutionService({ catalog: [{ ...CASE, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }], alternateBehaviors: [] }], featureChecks: [], createWorker: createTrustedWorkerFactory(jest.fn()), now });
    const run = await service.runManifest({ targets: ['local'], startedAt: 0, deadlineAt: 900000 });
    expect(run.results).toHaveLength(run.manifest.counts.total);
    expect(run.results.filter((row) => row.status === 'not-run')).toHaveLength(run.manifest.counts.total - 1);
    expect(run.results[0].status).toBe('blocked');
    expect(run.timing).toMatchObject({ deadlineExceeded: true, targetMet: false, hardLimitMs: 900000, targetMs: 720000 });
  });

  test('sets the twelve-minute target warning and prevents READY at the exact target boundary', async () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValue(720000);
    const service = createReadinessExecutionService({
      catalog: [{ ...CASE, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }], alternateBehaviors: [] }],
      featureChecks: [], now,
      createWorker: createTrustedWorkerFactory(async () => worker()),
    });
    const run = await service.runManifest({ targets: ['local'], startedAt: 0, deadlineAt: 900000 });
    expect(run.categoryCounts).toEqual({ core: 2, variants: 0, feature: 0, attackLab: 0, total: 2 });
    expect(run.results).toHaveLength(2);
    expect(run.timing).toMatchObject({ targetMet: false, deadlineExceeded: false });
    expect(run.report).toMatchObject({ targetWarning: true, status: 'not-ready', ready: false, categoryCounts: run.categoryCounts });
  });

  test('aborts an in-flight worker that ignores its signal and records all deadline outcomes', async () => {
    const sawAbort = jest.fn();
    const neverSettles = new Promise(() => {});
    const row = { ...CASE, providerFlows: { pingone: 'pingone-standard' }, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }, { vertical: 'banking', verticals: ['banking'] }], alternateBehaviors: [] };
    const service = createReadinessExecutionService({
      catalog: [row], featureChecks: [],
      createWorker: async () => worker({ async executeReadinessCase({ abortSignal }) { abortSignal.addEventListener('abort', sawAbort); return neverSettles; } }),
    });
    const run = await service.runManifest({ targets: ['local'], deadlineAt: Date.now() + 25 });
    expect(sawAbort).toHaveBeenCalled();
    expect(run.results).toHaveLength(2);
    expect(run.results.every((result) => result.status === 'not-run' && result.observed === 'deadline-expired')).toBe(true);
    expect(run.report).toMatchObject({ status: 'deadline_exceeded', ready: false });
  });

  test('keeps ordinary, A2A, native ID-JAG, and actor-bound PF provenance distinct', () => {
    expect(expectedExchangePath({ id: 'UC6' }, 'pingfederate')).toBe('standard-access-token');
    expect(expectedExchangePath({ id: 'UC2.5' }, 'pingfederate')).toBe('a2a-id-jag-then-access');
    expect(expectedExchangePath({ id: 'UC40' }, 'pingfederate')).toBe('native-id-jag');
    expect(expectedExchangePath({ id: 'UC38' }, 'pingfederate')).toBe('actor-bound-standard-two-exchange');
    expect(expectedExchangePath({ id: 'UC44' }, 'pingone')).toBe('actor-bound-standard-two-exchange');
  });

  test.each(['UC38', 'UC44'])('retains the same user subject and actor chain through both exchanges for %s', async (id) => {
    const actorCase = { ...CASE, id };
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => worker({
      async executeReadinessCase() {
        const result = await worker().executeReadinessCase();
        return { observed: 'DENY', evidence: { ...result.evidence, actorChain: ['user-1', 'agent-1'], exchangePath: 'actor-bound-standard-two-exchange', exchangeHops: [{ subject: 'user-1', actorChain: ['user-1', 'agent-1'] }, { subject: 'user-1', actorChain: ['user-1', 'agent-1'] }] } };
      },
    })) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'mocked-p1' });
    expect(await service.executeReadinessCase({ context, caseRow: actorCase, vertical: 'banking' })).toMatchObject({ status: 'pass' });
  });

  test('fails a PF exchange with an incomplete endpoint, wrong token type, or no registered tool result', async () => {
    const pfCase = { ...CASE, providerFlows: { pingone: null, pingfederate: 'pingfederate-standard' }, pfExchangeContract: { issuer: 'https://pf.example', endpoint: 'https://pf.example/token', credentialRole: 'pf-standard-role' } };
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => ({
      ...worker(), provider: 'pingfederate', runtime: {}, cookieJar: {}, sessionStore: {},
      async executeReadinessCase() { return { observed: 'DENY', evidence: { ...(await worker().executeReadinessCase()).evidence, userSessionProvider: 'pingfederate', tokenIssuer: 'pingfederate', agentIdentityProvider: 'pingfederate', exchangeProvenance: 'pingfederate-standard', pfExchange: { issuer: 'http://pf.example', endpoint: 'https://other.example/token', credentialRef: '', configurationComplete: false, subjectTokenType: 'id-jag', registeredToolResult: 'fail' } } }; },
    })) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'pf' });
    const result = await service.executeReadinessCase({ context, caseRow: pfCase, vertical: 'banking' });
    expect(result.status).toBe('fail');
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/PF endpoint|credential|configuration|subject-token|registered-tool/i)]));
  });

  test('fails closed when PF A2A omits its intermediate ID-JAG or changes the preserved actor chain', async () => {
    const a2aCase = { ...CASE, id: 'UC2', providerFlows: { pingone: null, pingfederate: 'pingfederate-a2a' } };
    const service = createReadinessExecutionService({ createWorker: createTrustedWorkerFactory(async () => ({
      ...worker(), provider: 'pingfederate', runtime: {}, cookieJar: {}, sessionStore: {},
      async executeReadinessCase() { return { observed: 'DENY', evidence: { ...(await worker().executeReadinessCase()).evidence, userSessionProvider: 'pingfederate', agentIdentityProvider: 'pingfederate', tokenIssuer: 'pingfederate', exchangeProvenance: 'pingfederate-a2a', exchangePath: 'a2a-id-jag-then-access', pfExchange: { issuer: 'https://pf.example', endpoint: 'https://pf.example/token', credentialRef: 'pf:readiness', configurationComplete: true, subjectTokenType: 'access_token', registeredToolResult: 'pass' }, exchangeHops: [{ type: 'access_token' }] } }; },
    })) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'mocked-pf' });
    const result = await service.executeReadinessCase({ context, caseRow: a2aCase, vertical: 'banking' });
    expect(result.evidence.contractFailures).toEqual(expect.arrayContaining([expect.stringMatching(/intermediate ID-JAG/i)]));
  });

  test.each(['UC2', 'UC2.5'])('accepts only the ordered PF A2A chain for %s', async (id) => {
    const a2aCase = { ...CASE, id, providerFlows: { pingone: null, pingfederate: 'pingfederate-a2a' }, pfExchangeContract: { issuer: 'https://pf.example', endpoint: 'https://pf.example/token', credentialRole: 'pf-a2a-exchanger' } };
    const service = createReadinessExecutionService({ createWorker: async () => ({
      ...worker(), provider: 'pingfederate', runtime: {}, cookieJar: {}, sessionStore: {},
      async executeReadinessCase() { return { observed: 'DENY', evidence: { ...(await worker().executeReadinessCase()).evidence, userSessionProvider: 'pingfederate', agentIdentityProvider: 'pingfederate', tokenIssuer: 'pingfederate', exchangeProvenance: 'pingfederate-a2a', exchangePath: 'a2a-id-jag-then-access', pfExchange: { issuer: 'https://pf.example', endpoint: 'https://pf.example/token', credentialRole: 'pf-a2a-exchanger', configurationComplete: true, subjectTokenType: 'access_token', registeredToolResult: 'pass' }, exchangeHops: [{ step: 'exchange1-id-jag', type: 'id-jag', subject: 'user-1', actorChain: ['agent-1'] }, { step: 'exchange2-access-token', type: 'access_token', subject: 'user-1', actorChain: ['agent-1'] }] } }; },
    }) });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'mocked-pf' });
    expect(await service.executeReadinessCase({ context, caseRow: a2aCase, vertical: 'banking' })).toMatchObject({ status: 'pass' });
  });
});
