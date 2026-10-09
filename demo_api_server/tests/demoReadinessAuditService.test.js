'use strict';

const { resolveRepositoryRoot } = require('../utils/repositoryRoot');
const { createAuditService, semanticEqual } = require('../services/demoReadinessAuditService');

const GATEWAY_EXPECTED = {
  issuer: 'https://pf.example.test',
  tokenEndpoint: 'https://pf.example.test/as/token.oauth2',
  clientId: 'pf-client',
  provenanceContains: 'ping-gateway',
};
const GATEWAY_OBSERVED = {
  issuerValue: GATEWAY_EXPECTED.issuer,
  endpointValue: GATEWAY_EXPECTED.tokenEndpoint,
  clientId: GATEWAY_EXPECTED.clientId,
  authority: true,
  pathPresent: true,
  credentials: true,
  mountSources: ['/repo/ping-gateway'],
};
const RUNTIME_AUDIENCE = { audience: 'mcpserver.ping.demo', scopes: ['read'] };

function passingAdapters(overrides = {}) {
  return {
    repository: {
      readContracts: jest.fn(() => ({
        scopeTopology: true,
        verticalManifests: true,
        routeAuth: true,
        prerequisiteParity: true,
        registeredTools: true,
        gatewayConfig: true,
        authorizeReferences: true,
      })),
    },
    pingOne: {
      readConfiguration: jest.fn(async () => ({
        audience: true, scope: true, mirror: true, appGrant: true,
        requiredFlag: true, a2aCredential: true, parSetting: true,
        groupMembership: true, registeredToolScope: true,
        authorizeEndpoint: true, policyReadback: true,
      })),
    },
    pingFederate: {
      readConfiguration: jest.fn(async () => ({
        clientGrantProcessorAtm: true, specialistResourceUriIdJag: true,
        jwksAudience: true,
      })),
    },
    runtime: {
      readTarget: jest.fn(async () => ({ health: { status: 'pass', observed: { bffStatus: 200, gatewayStatus: 401 } }, revision: 'abc123', expectedRevision: 'abc123', audienceScopes: RUNTIME_AUDIENCE })),
    },
    docker: {
      inspect: jest.fn(async () => GATEWAY_OBSERVED),
    },
    hostedGateway: { readConfiguration: jest.fn(async () => GATEWAY_OBSERVED) },
    ...overrides,
  };
}

describe('demo readiness audit service', () => {
  test('resolves the mounted repository when BFF code runs from /app in Docker', () => {
    expect(resolveRepositoryRoot('/app/services', {
      repositoryMount: '/repo',
      existsSync: (candidate) => candidate === '/repo/scope-topology.json',
    })).toBe('/repo');
  });

  test('uses the module-relative repository outside Docker', () => {
    expect(resolveRepositoryRoot('/workspace/demo_api_server/services', {
      repositoryMount: '/repo',
      existsSync: () => false,
    })).toBe('/workspace');
  });

  test('audits healthy local and hosted targets through read-only adapters', async () => {
    const adapters = passingAdapters();
    const audit = createAuditService({ adapters, pfProfiles: { roles: {} } });

    const local = await audit.auditTarget({
      targetId: 'local',
      targetConfig: { kind: 'local', pingOne: { environmentId: 'env' }, pingFederate: { baseUrl: 'https://pf.local' }, runtime: { expectedRevision: 'abc123', expectedAudienceScopes: RUNTIME_AUDIENCE }, gateway: { expected: GATEWAY_EXPECTED } },
      deadlineAt: Date.now() + 1_000,
    });
    const se = await audit.auditTarget({
      targetId: 'se',
      targetConfig: { kind: 'se', pingOne: { environmentId: 'env' }, pingFederate: { baseUrl: 'https://pf.se' }, runtime: { expectedRevision: 'abc123', expectedAudienceScopes: RUNTIME_AUDIENCE }, gateway: { expected: GATEWAY_EXPECTED } },
      deadlineAt: Date.now() + 1_000,
    });

    expect(local.every((check) => check.status === 'pass')).toBe(true);
    expect(se.every((check) => check.status === 'pass')).toBe(true);
    expect(adapters.docker.inspect).toHaveBeenCalledWith(expect.objectContaining({ targetKind: 'local' }));
    expect(adapters.runtime.readTarget).toHaveBeenCalledTimes(2);
  });

  test.each([
    'audience', 'scope', 'mirror', 'appGrant', 'requiredFlag', 'a2aCredential', 'parSetting',
    'groupMembership', 'registeredToolScope', 'gatewayConfig', 'authorizeEndpoint',
    'clientGrantProcessorAtm', 'specialistResourceUriIdJag',
    'jwksAudience', 'health', 'revision',
  ])('reports a failed required %s check', async (family) => {
    const adapters = passingAdapters();
    if (family === 'gatewayConfig') adapters.repository.readContracts.mockReturnValue({ ...adapters.repository.readContracts(), gatewayConfig: false });
    else if (family === 'health') adapters.runtime.readTarget.mockResolvedValue({ health: { status: 'fail' }, revision: 'abc123', expectedRevision: 'abc123', audienceScopes: RUNTIME_AUDIENCE });
    else if (family === 'revision') adapters.runtime.readTarget.mockResolvedValue({ health: { status: 'pass' }, revision: 'old', expectedRevision: 'new', audienceScopes: RUNTIME_AUDIENCE });
    else if (['clientGrantProcessorAtm', 'specialistResourceUriIdJag', 'jwksAudience'].includes(family)) {
      adapters.pingFederate.readConfiguration.mockResolvedValue({ clientGrantProcessorAtm: true, specialistResourceUriIdJag: true, jwksAudience: true, [family]: false });
    } else adapters.pingOne.readConfiguration.mockResolvedValue({ audience: true, scope: true, mirror: true, appGrant: true, requiredFlag: true, a2aCredential: true, parSetting: true, groupMembership: true, registeredToolScope: true, authorizeEndpoint: true, policyReadback: true, [family]: false });

    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditTarget({
      targetId: 'local', targetConfig: { kind: 'local', pingOne: {}, pingFederate: {}, runtime: { expectedRevision: family === 'revision' ? 'new' : 'abc123', expectedAudienceScopes: RUNTIME_AUDIENCE }, gateway: { expected: GATEWAY_EXPECTED } }, deadlineAt: Date.now() + 1_000,
    });
    expect(checks.find((check) => check.id.endsWith(`:${family}`))).toEqual(expect.objectContaining({ status: 'fail', required: true }));
  });

  test('blocks unavailable Authorize policy readback without substituting a decision', async () => {
    const adapters = passingAdapters();
    adapters.pingOne.readConfiguration.mockResolvedValue({ policyReadback: { status: 'blocked', reason: 'policy API unavailable' }, decision: true });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditPingOneConfiguration({ environmentId: 'env' });
    expect(checks.find((check) => check.id.endsWith(':policyReadback'))).toEqual(expect.objectContaining({ status: 'blocked', required: true }));
  });

  test('marks only the approved Authorize policy-tree readback gap as waived and keeps endpoint checks required', async () => {
    const adapters = passingAdapters();
    adapters.pingOne.readConfiguration.mockResolvedValue({
      authorizeEndpoint: true,
      policyReadback: {
        status: 'blocked',
        reason: 'complete PingOne Authorize policy-tree read is unavailable with current worker credentials',
        waiver: 'temporary-authorize-policy-tree-readback',
      },
    });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditPingOneConfiguration({ environmentId: 'env' });

    expect(checks.find((check) => check.id === 'pingone:policyReadback')).toEqual(expect.objectContaining({
      status: 'blocked',
      required: false,
      waiver: expect.stringMatching(/policy-tree parity is unverified/i),
    }));
    expect(checks.find((check) => check.id === 'pingone:authorizeEndpoint')).toEqual(expect.objectContaining({ status: 'pass', required: true }));
  });

  test('does not waive an Authorize policy mismatch even when adapter includes the waiver marker', async () => {
    const adapters = passingAdapters();
    adapters.pingOne.readConfiguration.mockResolvedValue({
      policyReadback: { status: 'fail', reason: 'policy differs from source', waiver: 'temporary-authorize-policy-tree-readback' },
    });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditPingOneConfiguration({ environmentId: 'env' });

    expect(checks.find((check) => check.id === 'pingone:policyReadback')).toEqual(expect.objectContaining({ status: 'fail', required: true }));
  });

  test('emits structured, source-backed repair candidates without making a write', async () => {
    const adapters = passingAdapters();
    adapters.pingOne.readConfiguration.mockResolvedValue({
      scope: {
        status: 'fail',
        repairCandidates: [{
          repairClass: 'pingone-scope-addition', target: 'local',
          object: { id: 'resource-1', kind: 'pingone-resource-scopes' },
          current: ['read'], expected: ['read', 'write'],
          sourceRef: 'scope-topology.json#resources/resource-1/scopes',
          operation: 'Create only the uniquely mapped missing PingOne resource scopes: write',
        }],
      },
    });

    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditPingOneConfiguration({ targetId: 'local' });
    expect(checks.find((row) => row.id === 'pingone:scope')).toEqual(expect.objectContaining({
      status: 'fail', target: 'local', repairCandidates: [expect.objectContaining({
        current: ['read'], expected: ['read', 'write'], sourceRef: 'scope-topology.json#resources/resource-1/scopes',
      })],
    }));
  });

  test('blocks a paginated scope read instead of proposing an incomplete repair', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/resources/resource-1/scopes')) return {
        _embedded: { scopes: [{ name: 'read' }] }, _links: { next: { href: 'next-page' } },
      };
      if (url.includes('/resources')) return { _embedded: { resources: [{ id: 'resource-1' }] } };
      if (url.includes('/applications')) return { _embedded: { applications: [] } };
      if (url.includes('/groups')) return { _embedded: { groups: [] } };
      return { _embedded: { decisionEndpoints: [] } };
    } }));
    const audit = createAuditService({ fetch, pfProfiles: { roles: {} } });

    const checks = await audit.auditPingOneConfiguration({
      targetId: 'local', environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { resourceScopes: { 'resource-1': ['read', 'write'] } },
    });
    expect(checks.find((row) => row.id === 'pingone:scope')).toEqual(expect.objectContaining({
      status: 'blocked', repairCandidates: [], evidence: expect.stringMatching(/complete scope list/i),
    }));
  });

  test('blocks unavailable PingFederate Admin API readback and undocumented roles', async () => {
    const adapters = passingAdapters({ pingFederate: {} });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: { undocumented: { unresolved: true } } } }).auditPingFederateConfiguration({ baseUrl: 'https://pf.local' });
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pingfederate:admin-api', status: 'blocked' }),
      expect.objectContaining({ id: 'pingfederate:profile:undocumented', status: 'blocked' }),
    ]));
  });

  test('fails a resolved role when its declared grant differs and does not impose ATM on an A2A specialist', async () => {
    const adapters = passingAdapters({
      pingFederate: {
        ...passingAdapters().pingFederate,
        readProfile: jest.fn(async ({ role }) => role === 'standard'
          ? { grantTypes: ['client_credentials'] }
          : { resourceUris: ['https://mcp.example.test'], idJag: true }),
      },
    });
    const profiles = { roles: {
      standard: { expected: { grantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'] }, sourceRef: 'provisioner' },
      specialist: { expected: { resourceUris: ['https://mcp.example.test'], idJag: true }, sourceRef: 'provisioner' },
    } };
    const checks = await createAuditService({ adapters, pfProfiles: profiles }).auditPingFederateConfiguration({ baseUrl: 'https://pf.local' });
    expect(checks.find((item) => item.id === 'pingfederate:profile:standard')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(checks.find((item) => item.id === 'pingfederate:profile:specialist')).toEqual(expect.objectContaining({ status: 'pass' }));
  });

  test('uses only argument-array docker adapters and never invokes a shell mutation', async () => {
    const execFile = jest.fn(async () => ({ stdout: '{}' }));
    const audit = createAuditService({ adapters: { execFile }, pfProfiles: { roles: {} } });
    await audit.auditLocalDockerConfiguration({ targetId: 'local', targetKind: 'local', hostedConfig: { expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 500 });
    expect(execFile).toHaveBeenCalledWith('docker', ['ps', '--format', '{{json .}}'], expect.any(Object));
    expect(execFile).toHaveBeenCalledWith('docker', ['inspect', 'ai-demo-ping-gateway'], expect.any(Object));
    expect(JSON.stringify(execFile.mock.calls)).not.toMatch(/compose|\brm\b|\bup\b|\bdown\b|\bkill\b/);
  });

  test('reads and parses PingOne Management API resources, applications, groups, and endpoints', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/resources')) return { _embedded: { resources: [{ id: 'resource-1', audience: 'https://api.example.test' }] } };
      if (url.includes('/applications')) return { _embedded: { applications: [{ id: 'app-1' }] } };
      if (url.includes('/groups')) return { _embedded: { groups: [{ id: 'group-1' }] } };
      return { _embedded: { decisionEndpoints: [{ id: 'endpoint-1' }] } };
    } }));
    const audit = createAuditService({ fetch, pfProfiles: { roles: {} } });
    const checks = await audit.auditPingOneConfiguration({
      environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { audiences: ['https://api.example.test'], applicationIds: ['app-1'], groupIds: ['group-1'], decisionEndpointIds: ['endpoint-1'] },
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/environments/env-1/resources?limit=100'), expect.objectContaining({ method: 'GET' }));
    expect(checks.find((row) => row.id === 'pingone:audience')).toEqual(expect.objectContaining({ status: 'pass', userSessionProvider: 'pingone' }));
    expect(checks.find((row) => row.id === 'pingone:policyReadback')).toEqual(expect.objectContaining({ status: 'blocked', required: false, waiver: expect.stringMatching(/policy-tree parity is unverified/i) }));
  });

  test('parses Gateway Exchange #3 environment without returning credential values', async () => {
    const execFile = jest.fn()
      .mockResolvedValueOnce({ stdout: '{"Names":"ai-demo-ping-gateway"}\n' })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ Config: { Env: [
        'PF_ISSUER_URI=https://pf.example.test', 'PF_TOKEN_ENDPOINT=https://pf.example.test/as/token.oauth2',
        'PF_TE_CLIENT_ID=pf-client', 'PF_TE_CLIENT_SECRET=actual-secret', 'PF_TE_AUTH_METHOD=basic',
      ] }, Mounts: [{ Source: '/repo/ping-gateway', Destination: '/opt/out/instance' }] }]) });
    const checks = await createAuditService({ adapters: { execFile }, pfProfiles: { roles: {} } }).auditLocalDockerConfiguration({ targetId: 'local', targetKind: 'local', hostedConfig: { expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 500 });
    expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'gateway:pf-exchange3', status: 'pass' })]));
    expect(JSON.stringify(checks)).not.toContain('actual-secret');
  });

  test('redacts returned evidence and converts a late read into not-run', async () => {
    const adapters = passingAdapters({
      runtime: { readTarget: jest.fn(async () => ({ health: { status: 'pass', reason: 'Bearer abc.def.ghi' }, revision: 'old', expectedRevision: 'old', audienceScopes: RUNTIME_AUDIENCE })) },
    });
    const audit = createAuditService({ adapters, pfProfiles: { roles: {} } });
    const checks = await audit.auditTarget({ targetId: 'local', targetConfig: { kind: 'se', pingOne: {}, pingFederate: {}, runtime: { expectedAudienceScopes: RUNTIME_AUDIENCE }, gateway: { expected: GATEWAY_EXPECTED } }, deadlineAt: Date.now() - 1 });
    expect(checks[0]).toEqual(expect.objectContaining({ status: 'not-run', providerApplicability: expect.any(Object) }));
    expect(JSON.stringify(await audit.auditRuntimeTarget({}))).not.toContain('abc.def.ghi');
  });

  test('blocks every PF role when an Admin API reader cannot read profiles', async () => {
    const profiles = { roles: { standard: { objectId: 'standard-client', unresolved: false, expected: { grantTypes: ['TOKEN_EXCHANGE'] }, sourceRef: 'source' } } };
    const checks = await createAuditService({ adapters: passingAdapters(), pfProfiles: profiles }).auditPingFederateConfiguration({ baseUrl: 'https://pf.example.test:9999/pf-admin-api/v1' });
    expect(checks.find((row) => row.id === 'pingfederate:profile:standard')).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('reads PF Admin clients and compares a concrete declared role', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.endsWith('/oauth/clients')) return [{ clientId: 'standard-client', grantTypes: ['TOKEN_EXCHANGE'] }];
      return [];
    } }));
    const profiles = { roles: {
      standard: { objectId: 'standard-client', unresolved: false, expected: { grantTypes: ['TOKEN_EXCHANGE'] }, sourceRef: 'committed profile' },
    } };
    const checks = await createAuditService({ fetch, pfProfiles: profiles }).auditPingFederateConfiguration({
      baseUrl: 'https://pf.example.test:9999/pf-admin-api/v1',
      credentials: { accessToken: 'pf-secret' },
    });
    expect(fetch).toHaveBeenCalledWith('https://pf.example.test:9999/pf-admin-api/v1/oauth/clients', expect.objectContaining({ method: 'GET' }));
    expect(checks.find((row) => row.id === 'pingfederate:profile:standard')).toEqual(expect.objectContaining({ status: 'pass' }));
  });

  test('blocks hosted Gateway booleans and requires a supported hosted readback', async () => {
    const audit = createAuditService({ adapters: passingAdapters({ hostedGateway: {} }), pfProfiles: { roles: {} } });
    const checks = await audit.auditLocalDockerConfiguration({
      targetId: 'se', targetKind: 'se', hostedConfig: { pfExchange3: true, expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 1_000,
    });
    expect(checks).toEqual([expect.objectContaining({ status: 'blocked', required: true })]);
  });

  test('fails concrete Gateway differences instead of accepting environment presence', async () => {
    const adapters = passingAdapters({ docker: { inspect: jest.fn(async () => ({ ...GATEWAY_OBSERVED, endpointValue: 'http://wrong.example.test/token', credentials: false })) } });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditLocalDockerConfiguration({
      targetId: 'local', targetKind: 'local', hostedConfig: { expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 1_000,
    });
    expect(checks[0]).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(checks[0].observed).toEqual(expect.objectContaining({ endpoint: false, distinctCredentialsPresent: false }));
  });

  test('blocks unknown runtime audience/scope values rather than accepting a truthy object', async () => {
    const adapters = passingAdapters({ runtime: { readTarget: jest.fn(async () => ({ health: { status: 'pass' }, revision: 'abc123', expectedRevision: 'abc123', audienceScopes: { audience: 'other', scopes: ['read', 'write'] } })) } });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditRuntimeTarget({ expectedAudienceScopes: RUNTIME_AUDIENCE });
    expect(checks.find((row) => row.id === 'runtime:audience-scope')).toEqual(expect.objectContaining({ status: 'fail' }));
  });

  test('keeps an injected PingOne reader rejection within blocking family rows', async () => {
    const adapters = passingAdapters({ pingOne: { readConfiguration: jest.fn(async () => { throw new Error('unauthorized reader'); }) } });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditTarget({
      targetId: 'local', targetConfig: { kind: 'local', pingOne: {}, pingFederate: {}, runtime: { expectedAudienceScopes: RUNTIME_AUDIENCE }, gateway: { expected: GATEWAY_EXPECTED } }, deadlineAt: Date.now() + 1_000,
    });
    expect(checks.filter((row) => row.id.startsWith('pingone:'))).toHaveLength(11);
    expect(checks.filter((row) => row.id.startsWith('pingone:')).every((row) => row.status === 'blocked')).toBe(true);
  });

  test('uses deadline-bound Docker execution options', async () => {
    const execFile = jest.fn()
      .mockResolvedValueOnce({ stdout: '{"Names":"ai-demo-ping-gateway"}\n' })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ Config: { Env: [] }, Mounts: [] }]) });
    await createAuditService({ adapters: { execFile }, pfProfiles: { roles: {} } }).auditLocalDockerConfiguration({
      targetId: 'local', targetKind: 'local', hostedConfig: { expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 500,
    });
    const options = execFile.mock.calls[0][2];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test('blocks a 5xx Gateway probe in the default runtime read', async () => {
    const preflight = require('../../scripts/check-mcp-preflight');
    const gate = require('../../scripts/check-demo-health-gate');
    const probe = jest.spyOn(preflight, 'probe').mockResolvedValue({ status: 503 });
    const health = jest.spyOn(gate, 'fetchJson').mockResolvedValue({ status: 200, body: { revision: 'abc123', audienceScopes: RUNTIME_AUDIENCE } });
    try {
      const fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ audienceScopes: RUNTIME_AUDIENCE }) }));
      const checks = await createAuditService({ fetch, pfProfiles: { roles: {} } }).auditRuntimeTarget({
        bffUrl: 'https://bff.example.test', gatewayUrl: 'https://gateway.example.test/mcp', authorizeUrl: 'https://authorize.example.test', expectedRevision: 'abc123', expectedAudienceScopes: RUNTIME_AUDIENCE, deadlineAt: Date.now() + 1_000,
      });
      expect(checks.find((row) => row.id === 'runtime:health')).toEqual(expect.objectContaining({ status: 'blocked' }));
    } finally {
      probe.mockRestore();
      health.mockRestore();
    }
  });

  test('emits all 51 repository rows and blocks A2A or PAR fields pending live readback', async () => {
    const checks = await createAuditService({ pfProfiles: { roles: {} } }).auditRepositoryContracts();
    const cases = checks.filter((row) => row.id.startsWith('repository:case:'));
    expect(cases).toHaveLength(51);
    expect(cases.some((row) => row.status === 'blocked' && /A2A|PAR/.test(row.evidence || ''))).toBe(true);
    expect(cases.every((row) => row.observed && Array.isArray(row.observed.flags))).toBe(true);
  });

  test('requires a caller-declared revision rather than an adapter self-confirmation', async () => {
    const audit = createAuditService({ adapters: passingAdapters(), pfProfiles: { roles: {} } });
    const checks = await audit.auditRuntimeTarget({ expectedAudienceScopes: RUNTIME_AUDIENCE });
    expect(checks.find((row) => row.id === 'runtime:revision')).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('compares Gateway source maps without depending on object key order', async () => {
    expect(semanticEqual({ read: { resource: 'api' }, write: { resource: 'api' } }, { write: { resource: 'api' }, read: { resource: 'api' } })).toBe(true);
    const checks = await createAuditService({ pfProfiles: { roles: {} } }).auditRepositoryContracts();
    expect(checks.find((row) => row.id === 'repository:gatewayConfig')).toEqual(expect.objectContaining({ status: 'pass' }));
  });

  test('uses the Admin contract for every Admin row without requiring vertical prerequisites', async () => {
    const checks = await createAuditService({ pfProfiles: { roles: {} } }).auditRepositoryContracts();
    const admins = checks.filter((row) => /^repository:case:ADMIN(?:[1-9]|1[0-2])$/.test(row.id));
    expect(admins).toHaveLength(12);
    expect(admins.every((row) => row.status === 'pass')).toBe(true);
  });

  test('blocks Admin cases whose declared action or hosted tool is not registered', async () => {
    const inventory = require('../config/demoReadinessInventory.json');
    const originalAction = inventory.adminExpectations.ADMIN7;
    const originalTool = inventory.adminExpectations.ADMIN1;
    try {
      inventory.adminExpectations.ADMIN7 = { ...originalAction, expectedAction: 'list_pingone_toolz' };
      inventory.adminExpectations.ADMIN1 = { ...originalTool, expectedTool: 'listApplicatoins' };
      const checks = await createAuditService({ pfProfiles: { roles: {} } }).auditRepositoryContracts();
      expect(checks.find((row) => row.id === 'repository:case:ADMIN7')).toEqual(expect.objectContaining({ status: 'fail' }));
      expect(checks.find((row) => row.id === 'repository:case:ADMIN1')).toEqual(expect.objectContaining({ status: 'fail' }));
    } finally {
      inventory.adminExpectations.ADMIN7 = originalAction;
      inventory.adminExpectations.ADMIN1 = originalTool;
    }
  });

  test('reads declared subject group membership and rejects exact PingOne scope, grant, and audience extras', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/memberOfGroups')) return { _embedded: { memberOfGroups: [{ group: { id: 'group-1' } }] } };
      if (url.includes('/resources/resource-1/scopes')) return { _embedded: { scopes: [{ name: 'read' }, { name: 'write' }] } };
      if (url.includes('/applications/app-1/grants')) return { _embedded: { grants: [{ scopes: [{ name: 'read' }, { name: 'write' }] }] } };
      if (url.includes('/resources')) return { _embedded: { resources: [{ audience: 'https://api.example.test' }, { audience: 'https://extra.example.test' }] } };
      if (url.includes('/applications')) return { _embedded: { applications: [{ id: 'app-1' }] } };
      if (url.includes('/groups')) return { _embedded: { groups: [{ id: 'group-1' }] } };
      return { _embedded: { decisionEndpoints: [{ id: 'endpoint-1' }] } };
    } }));
    const checks = await createAuditService({ fetch, pfProfiles: { roles: {} } }).auditPingOneConfiguration({
      environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { audiences: ['https://api.example.test'], resourceScopes: { 'resource-1': ['read'] }, applicationGrants: { 'app-1': ['read'] }, groupMemberships: { 'user-1': ['group-1'] } },
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/users/user-1/memberOfGroups?limit=100'), expect.any(Object));
    expect(checks.find((row) => row.id === 'pingone:audience')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(checks.find((row) => row.id === 'pingone:scope')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(checks.find((row) => row.id === 'pingone:appGrant')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(checks.find((row) => row.id === 'pingone:groupMembership')).toEqual(expect.objectContaining({ status: 'pass' }));
  });

  test('rejects grants on an application absent from the declared grant contract', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/applications/app-1/grants')) return { _embedded: { grants: [{ scopes: [{ name: 'read' }] }] } };
      if (url.includes('/applications/app-2/grants')) return { _embedded: { grants: [{ scopes: [{ name: 'admin:write' }] }] } };
      if (url.includes('/resources')) return { _embedded: { resources: [] } };
      if (url.includes('/applications')) return { _embedded: { applications: [{ id: 'app-1' }, { id: 'app-2' }] } };
      if (url.includes('/groups')) return { _embedded: { groups: [] } };
      return { _embedded: { decisionEndpoints: [] } };
    } }));
    const checks = await createAuditService({ fetch, pfProfiles: { roles: {} } }).auditPingOneConfiguration({
      environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { applicationGrants: { 'app-1': ['read'] } },
    });
    expect(checks.find((row) => row.id === 'pingone:appGrant')).toEqual(expect.objectContaining({ status: 'fail' }));
  });

  test('blocks application-grant parity when PingOne reports another application page', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/applications/app-1/grants')) return { _embedded: { grants: [{ scopes: [{ name: 'read' }] }] } };
      if (url.includes('/resources')) return { _embedded: { resources: [] } };
      if (url.includes('/applications')) return { _embedded: { applications: [{ id: 'app-1' }] }, _links: { next: { href: 'https://api.pingone.example.test/next' } } };
      if (url.includes('/groups')) return { _embedded: { groups: [] } };
      return { _embedded: { decisionEndpoints: [] } };
    } }));
    const checks = await createAuditService({ fetch, pfProfiles: { roles: {} } }).auditPingOneConfiguration({
      environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { applicationGrants: { 'app-1': ['read'] } },
    });
    expect(checks.find((row) => row.id === 'pingone:appGrant')).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('blocks application-grant parity when an application grant page is incomplete', async () => {
    const fetch = jest.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (url.includes('/applications/app-1/grants')) return { _embedded: { grants: [{ scopes: [{ name: 'read' }] }] }, _links: { next: { href: 'https://api.pingone.example.test/next' } } };
      if (url.includes('/resources')) return { _embedded: { resources: [] } };
      if (url.includes('/applications')) return { _embedded: { applications: [{ id: 'app-1' }] } };
      if (url.includes('/groups')) return { _embedded: { groups: [] } };
      return { _embedded: { decisionEndpoints: [] } };
    } }));
    const checks = await createAuditService({ fetch, pfProfiles: { roles: {} } }).auditPingOneConfiguration({
      environmentId: 'env-1', credentials: { accessToken: 'secret-token' },
      expected: { applicationGrants: { 'app-1': ['read'] } },
    });
    expect(checks.find((row) => row.id === 'pingone:appGrant')).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('bounds an adapter that ignores the deadline and passes it an abortable signal', async () => {
    const readTarget = jest.fn(() => new Promise(() => {}));
    const started = Date.now();
    const checks = await createAuditService({ adapters: { runtime: { readTarget } }, pfProfiles: { roles: {} } }).auditRuntimeTarget({
      expectedRevision: 'abc123', expectedAudienceScopes: RUNTIME_AUDIENCE, deadlineAt: Date.now() + 20,
    });
    expect(Date.now() - started).toBeLessThan(150);
    expect(readTarget.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(checks[0]).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('bounds a Docker adapter that ignores cancellation rather than delaying the target audit', async () => {
    const inspect = jest.fn(() => new Promise(() => {}));
    const started = Date.now();
    const checks = await createAuditService({ adapters: { docker: { inspect } }, pfProfiles: { roles: {} } }).auditLocalDockerConfiguration({
      targetId: 'local', targetKind: 'local', hostedConfig: { expected: GATEWAY_EXPECTED }, deadlineAt: Date.now() + 20,
    });
    expect(Date.now() - started).toBeLessThan(150);
    expect(inspect.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(checks[0]).toEqual(expect.objectContaining({ status: 'not-run' }));
  });
});
