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
      readTarget: jest.fn(async () => ({ health: true, revision: 'abc123', expectedRevision: 'abc123' })),
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
      targetConfig: { kind: 'se', pingOne: { environmentId: 'env' }, pingFederate: { baseUrl: 'https://pf.se' } },
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
});
