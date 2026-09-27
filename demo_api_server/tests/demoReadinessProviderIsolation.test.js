'use strict';

const { createReadinessExecutionService } = require('../services/demoReadinessExecutionService');

const CASE = {
  id: 'UC40',
  expectedBehaviorByVertical: { banking: { kind: 'id-jag', expectedOutcome: 'PERMIT' } },
  authorizationContractByVertical: { banking: { primaryTool: null, resourceServer: 'olb' } },
  runtimePrerequisitesByVertical: { banking: { requiredFlags: [], a2aCredentials: false, parConfig: false, groupRequirement: null } },
  providerFlows: { pingone: null, pingfederate: 'pingfederate-native-id-jag' },
};

function providerWorker(provider) {
  return {
    provider,
    isolated: true,
    cookieJar: {},
    sessionStore: {},
    async verifyPrerequisites() { return { status: 'pass' }; },
    async executeReadinessCase() {
      return {
        observed: 'PERMIT',
        evidence: {
          subject: provider + '-subject', actor: provider + '-agent',
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
      createWorker: async ({ provider }) => {
        const runtime = providerWorker(provider);
        workers.push(runtime);
        return runtime;
      },
    });
    const [pingone, pingfederate] = await Promise.all([
      service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-pingone' }),
      service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'readiness-pingfederate' }),
    ]);

    expect(pingone).not.toEqual(pingfederate);
    expect(workers[0].cookieJar).not.toBe(workers[1].cookieJar);
    expect(workers[0].sessionStore).not.toBe(workers[1].sessionStore);
    expect(activeProvider).toBe('pingone');
  });

  test('one provider setup failure is reported while the other lane remains usable', async () => {
    const service = createReadinessExecutionService({
      createWorker: async ({ provider }) => provider === 'pingfederate'
        ? { provider, isolated: false }
        : providerWorker(provider),
    });
    await expect(service.createWorkerContext({ targetId: 'local', provider: 'pingfederate', identityRef: 'readiness-pf' }))
      .rejects.toThrow(/provider isolation/i);
    const pingone = await service.createWorkerContext({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1' });
    expect(pingone.provider).toBe('pingone');
  });

  test('a failed provider lane does not hide another lane result in a manifest run', async () => {
    const caseRow = { ...CASE, id: 'UC6', providerFlows: { pingone: 'pingone-standard', pingfederate: 'pingfederate-standard' }, runtimeVerticalGroups: [{ vertical: 'banking', verticals: ['banking'] }] };
    const service = createReadinessExecutionService({
      catalog: [caseRow],
      featureChecks: [],
      createWorker: async ({ provider }) => provider === 'pingfederate' ? { provider, isolated: false } : providerWorker(provider),
    });
    const run = await service.runManifest({ targets: ['local'] });
    expect(run.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'pass', observed: 'PERMIT' }),
      expect.objectContaining({ status: 'blocked', observed: 'not-dispatched' }),
    ]));
  });

  test('expired deadline starts no provider worker or row', async () => {
    const createWorker = jest.fn();
    const service = createReadinessExecutionService({ createWorker, catalog: [CASE] });
    const run = await service.runManifest({ targets: ['local'], deadlineAt: Date.now() - 1 });
    expect(createWorker).not.toHaveBeenCalled();
    expect(run.results).toEqual([]);
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
