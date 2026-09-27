'use strict';

const { createAuditService } = require('../services/demoReadinessAuditService');

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
        davinciClientAdapter: true, jwksAudience: true,
      })),
    },
    runtime: {
      readTarget: jest.fn(async () => ({ health: true, revision: 'abc123', expectedRevision: 'abc123', audienceScopes: { audience: 'mcpserver.ping.demo', scopes: ['read'] } })),
    },
    docker: {
      inspect: jest.fn(async () => ({ pfIssuer: true, endpointAuthority: true, endpointPath: true, distinctCredentials: true, provenance: true })),
    },
    ...overrides,
  };
}

describe('demo readiness audit service', () => {
  test('audits healthy local and hosted targets through read-only adapters', async () => {
    const adapters = passingAdapters();
    const audit = createAuditService({ adapters, pfProfiles: { roles: {} } });

    const local = await audit.auditTarget({
      targetId: 'local',
      targetConfig: { kind: 'local', pingOne: { environmentId: 'env' }, pingFederate: { baseUrl: 'https://pf.local' } },
      deadlineAt: Date.now() + 1_000,
    });
    const se = await audit.auditTarget({
      targetId: 'se',
      targetConfig: { kind: 'se', pingOne: { environmentId: 'env' }, pingFederate: { baseUrl: 'https://pf.se' }, gateway: { pfExchange3: true } },
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
    'clientGrantProcessorAtm', 'specialistResourceUriIdJag', 'davinciClientAdapter',
    'jwksAudience', 'health', 'revision',
  ])('reports a failed required %s check', async (family) => {
    const adapters = passingAdapters();
    if (family === 'gatewayConfig') adapters.repository.readContracts.mockReturnValue({ ...adapters.repository.readContracts(), gatewayConfig: false });
    else if (family === 'health') adapters.runtime.readTarget.mockResolvedValue({ health: false, revision: 'abc123', expectedRevision: 'abc123' });
    else if (family === 'revision') adapters.runtime.readTarget.mockResolvedValue({ health: true, revision: 'old', expectedRevision: 'new' });
    else if (['clientGrantProcessorAtm', 'specialistResourceUriIdJag', 'davinciClientAdapter', 'jwksAudience'].includes(family)) {
      adapters.pingFederate.readConfiguration.mockResolvedValue({ clientGrantProcessorAtm: true, specialistResourceUriIdJag: true, davinciClientAdapter: true, jwksAudience: true, [family]: false });
    } else adapters.pingOne.readConfiguration.mockResolvedValue({ audience: true, scope: true, mirror: true, appGrant: true, requiredFlag: true, a2aCredential: true, parSetting: true, groupMembership: true, registeredToolScope: true, authorizeEndpoint: true, policyReadback: true, [family]: false });

    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditTarget({
      targetId: 'local', targetConfig: { kind: 'local', pingOne: {}, pingFederate: {} }, deadlineAt: Date.now() + 1_000,
    });
    expect(checks.find((check) => check.id.endsWith(`:${family}`))).toEqual(expect.objectContaining({ status: 'fail', required: true }));
  });

  test('blocks unavailable Authorize policy readback without substituting a decision', async () => {
    const adapters = passingAdapters();
    adapters.pingOne.readConfiguration.mockResolvedValue({ policyReadback: { status: 'blocked', reason: 'policy API unavailable' }, decision: true });
    const checks = await createAuditService({ adapters, pfProfiles: { roles: {} } }).auditPingOneConfiguration({ environmentId: 'env' });
    expect(checks.find((check) => check.id.endsWith(':policyReadback'))).toEqual(expect.objectContaining({ status: 'blocked', required: true }));
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
    await audit.auditLocalDockerConfiguration({ targetId: 'local', targetKind: 'local' });
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
    expect(checks.find((row) => row.id === 'pingone:policyReadback')).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  test('parses Gateway Exchange #3 environment without returning credential values', async () => {
    const execFile = jest.fn()
      .mockResolvedValueOnce({ stdout: '{"Names":"ai-demo-ping-gateway"}\n' })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ Config: { Env: [
        'PF_ISSUER_URI=https://pf.example.test', 'PF_TOKEN_ENDPOINT=https://pf.example.test/as/token.oauth2',
        'PF_TE_CLIENT_ID=pf-client', 'PF_TE_CLIENT_SECRET=actual-secret', 'PF_TE_AUTH_METHOD=basic',
      ] }, Mounts: [{ Source: '/repo/ping-gateway', Destination: '/opt/out/instance' }] }]) });
    const checks = await createAuditService({ adapters: { execFile }, pfProfiles: { roles: {} } }).auditLocalDockerConfiguration({ targetId: 'local', targetKind: 'local' });
    expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'gateway:pf-exchange3', status: 'pass' })]));
    expect(JSON.stringify(checks)).not.toContain('actual-secret');
  });

  test('redacts returned evidence and converts a late read into not-run', async () => {
    const adapters = passingAdapters({
      runtime: { readTarget: jest.fn(async () => ({ health: { status: 'pass', reason: 'Bearer abc.def.ghi' }, revision: 'old', expectedRevision: 'old' })) },
    });
    const audit = createAuditService({ adapters, pfProfiles: { roles: {} } });
    const checks = await audit.auditTarget({ targetId: 'local', targetConfig: { kind: 'se', pingOne: {}, pingFederate: {}, runtime: {} }, deadlineAt: Date.now() - 1 });
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
});
