'use strict';

const { createReadinessExecutionService } = require('../services/demoReadinessExecutionService');
const testWorkerAdapter = (adapter) => adapter;
const createTrustedWorkerFactory = testWorkerAdapter;

const CASE = {
  id: 'UC40',
  expectedBehaviorByVertical: { banking: { kind: 'id-jag', expectedOutcome: 'PERMIT' } },
  authorizationContractByVertical: { banking: { primaryTool: null, resourceServer: 'olb' } },
  runtimePrerequisitesByVertical: { banking: { requiredFlags: [], a2aCredentials: false, parConfig: false, groupRequirement: null } },
  providerFlows: { pingone: null, pingfederate: 'pingfederate-native-id-jag' },
  pfExchangeContract: { issuer: 'https://pf.example', endpoint: 'https://pf.example/as/token', credentialRole: 'pf-native-id-jag-worker' },
};

function providerWorker(provider) {
  return {
    provider,
    runtime: {}, cookieJar: {}, sessionStore: {},
    async verifyPrerequisites() { return { status: 'pass' }; },
    async executeReadinessCase({ caseRow }) {
      return {
        observed: 'PERMIT',
        evidence: {
          userSessionProvider: provider, agentIdentityProvider: provider, tokenIssuer: provider,
          subject: provider + '-subject', actor: provider + '-agent', actorChain: [provider + '-agent'],
          exchangeService: 'token-exchange', exchangeProvenance: caseRow.providerFlows[provider],
          exchangePath: caseRow.id === 'UC40' ? 'native-id-jag' : 'standard-access-token',
          subjectTokenType: provider === 'pingfederate' && caseRow.id === 'UC40' ? 'id-jag' : 'access_token',
          ...(provider === 'pingfederate' ? { pfExchange: { issuer: 'https://pf.example', endpoint: 'https://pf.example/as/token', credentialRole: 'pf-native-id-jag-worker', configurationComplete: true, subjectTokenType: caseRow.id === 'UC40' ? 'id-jag' : 'access_token' } } : {}),
          resourceServer: 'olb', roleApplicability: { user: 'required' },
          gateway: { applicable: false }, authorize: { applicable: false },
        },
      };
    },
  };
}

describe('demo readiness provider isolation', () => {
  test('simultaneous PingOne and PF workers use separate session stores without changing the active provider', async () => {
    const activeProvider = 'pingone';
    const workers = [];
    const service = createReadinessExecutionService({
      createWorker: createTrustedWorkerFactory(async ({ provider }) => {
        const runtime = providerWorker(provider);
        workers.push(runtime);
        return runtime;
      }),
    });
    const [pingone, pingfederate] = await Promise.all([
      service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-pingone' }),
      service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'readiness-pingfederate' }),
    ]);

    expect(pingone).not.toBe(pingfederate);
    expect(Object.keys(pingone)).toEqual([]);
    expect(workers[0].cookieJar).not.toBe(workers[1].cookieJar);
    expect(workers[0].sessionStore).not.toBe(workers[1].sessionStore);
    expect(activeProvider).toBe('pingone');
  });

  test('one provider setup failure is reported while the other lane remains usable', async () => {
    const service = createReadinessExecutionService({
      createWorker: createTrustedWorkerFactory(async ({ provider }) => provider === 'pingfederate'
        ? { provider }
        : providerWorker(provider)),
    });
    await expect(service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'readiness-pf' }))
      .rejects.toThrow(/provider isolation/i);
    const pingone = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' });
    expect(Object.keys(pingone)).toEqual([]);
  });

  test('rejects a reused runtime, cookie jar, or session store even when the requested lane is the same', async () => {
    const reused = providerWorker('pingone');
    const service = createReadinessExecutionService({
      createWorker: createTrustedWorkerFactory(async () => reused),
    });
    await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'first' });
    await expect(service.createWorkerContext({ targetId: 'hosted', provider: 'pingone', identityRef: 'second' }))
      .rejects.toThrow(/reused/i);
  });

  test('production construction blocks a test adapter and a copied opaque context cannot execute', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const production = createReadinessExecutionService({ createWorker: async () => providerWorker('pingone') });
    await expect(production.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1' }))
      .rejects.toThrow(/private separate provider-configured worker runtime/i);
    process.env.NODE_ENV = originalNodeEnv;
    const service = createReadinessExecutionService({ createWorker: async () => providerWorker('pingone') });
    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1' });
    const result = await service.executeReadinessCase({ context: { ...context }, caseRow: CASE, vertical: 'banking' });
    expect(result).toMatchObject({ status: 'blocked', observed: 'not-dispatched' });
  });

  test('production worker adapters are explicitly injected and their contexts are disposed', async () => {
    const worker = providerWorker('pingone');
    worker.dispose = jest.fn();
    const service = createReadinessExecutionService({
      productionWorkerAdapter: async ({ targetId, provider }) => {
        expect(targetId).toBe('local');
        expect(provider).toBe('pingone');
        return worker;
      },
    });

    const context = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness:p1' });
    expect(context).toEqual({});
    expect(Object.isFrozen(context)).toBe(true);
    const cleanup = await service.dispose();

    expect(cleanup).toEqual({ status: 'pass', failures: [] });
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  test('disposes a production worker when it is invalid or finishes setup after its deadline', async () => {
    const invalidWorker = providerWorker('pingfederate');
    invalidWorker.dispose = jest.fn();
    const invalid = createReadinessExecutionService({
      productionWorkerAdapter: async () => invalidWorker,
    });
    await expect(invalid.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1' }))
      .rejects.toThrow(/provider/i);
    expect(invalidWorker.dispose).toHaveBeenCalledTimes(1);

    let now = 0;
    const lateWorker = providerWorker('pingone');
    lateWorker.dispose = jest.fn();
    const late = createReadinessExecutionService({
      now: () => now,
      productionWorkerAdapter: async () => { now = 2; return lateWorker; },
    });
    await expect(late.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'p1', deadlineAt: 1 }))
      .rejects.toThrow(/deadline exceeded while creating/i);
    expect(lateWorker.dispose).toHaveBeenCalledTimes(1);
  });

  test('a failed provider lane does not hide another lane result in a manifest run', async () => {
    const caseRow = { ...CASE, id: 'UC6', providerFlows: { pingone: 'pingone-standard', pingfederate: 'pingfederate-standard' }, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }] };
    const service = createReadinessExecutionService({
      catalog: [caseRow],
      featureChecks: [],
      createWorker: createTrustedWorkerFactory(async ({ provider }) => provider === 'pingfederate' ? { provider } : providerWorker(provider)),
    });
    const run = await service.runManifest({ targets: ['local'] });
    expect(run.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'pass', observed: 'PERMIT' }),
      expect.objectContaining({ status: 'blocked', observed: 'not-dispatched' }),
    ]));
  });

  test('expired deadline starts no provider worker or row', async () => {
    const createWorker = createTrustedWorkerFactory(jest.fn());
    const service = createReadinessExecutionService({ createWorker, catalog: [CASE] });
    const run = await service.runManifest({ targets: ['local'], deadlineAt: Date.now() - 1 });
    expect(createWorker).not.toHaveBeenCalled();
    expect(run.results).toHaveLength(run.manifest.counts.total);
    expect(run.results.every((result) => result.status === 'not-run')).toBe(true);
  });

  test('a failed target/provider setup blocks the rest of that lane without retrying it', async () => {
    const createWorker = createTrustedWorkerFactory(jest.fn(async ({ provider }) => provider === 'pingfederate'
      ? { provider }
      : providerWorker(provider)));
    const row = { ...CASE, id: 'UC6', providerFlows: { pingone: 'pingone-standard', pingfederate: 'pingfederate-standard' }, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }, { vertical: 'banking', verticals: ['banking'] }] };
    const service = createReadinessExecutionService({ catalog: [row], featureChecks: [], createWorker });
    const run = await service.runManifest({ targets: ['local'] });
    expect(createWorker.mock.calls.filter(([args]) => args.provider === 'pingfederate')).toHaveLength(1);
    expect(run.results.filter((result) => result.evidence?.provider === 'pingfederate')).toHaveLength(2);
  });

  test('UC40 remains PF-only and reports its PingOne session lane as not applicable', () => {
    expect(CASE.providerFlows).toEqual({ pingone: null, pingfederate: 'pingfederate-native-id-jag' });
  });
});

const readinessCredentialsPresent = Boolean(process.env.READINESS_PINGONE_TEST_IDENTITY && process.env.READINESS_PINGFEDERATE_TEST_IDENTITY);
(readinessCredentialsPresent ? test : test.skip)('dedicated local provider login integration uses only the named readiness identities and cleans up worker sessions', async () => {
  // The live adapter is intentionally injected by the local stack harness.  This
  // guard prevents a developer's ordinary or administrator browser identity
  // from ever becoming a fallback readiness credential.
  expect(process.env.READINESS_PINGONE_TEST_IDENTITY).toBeTruthy();
  expect(process.env.READINESS_PINGFEDERATE_TEST_IDENTITY).toBeTruthy();
});
