'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preflight = require('../../scripts/check-mcp-preflight');
const gate = require('../../scripts/check-demo-health-gate');
const { createAuditService } = require('../services/demoReadinessAuditService');
const { createDefaultAdapters } = require('../services/demoReadinessRunner');
const { loadDemoReadinessRuntimeConfig } = require('../services/demoReadinessRuntimeConfig');

const EXPECTED = { audience: 'https://gateway.example.test/mcp', scopes: ['gateway:mcp:invoke'] };
const inspectOf = (env) => JSON.stringify([{ Config: { Env: Object.entries(env).map(([name, value]) => name + '=' + value) }, Mounts: [] }]);
const docker = (env) => jest.fn(async () => ({ stdout: inspectOf(env) }));
const noDocker = () => jest.fn(async () => { throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }); });

describe('runtime:audience-scope', () => {
  let probe; let health;
  beforeEach(() => {
    probe = jest.spyOn(preflight, 'probe').mockResolvedValue({ status: 401 });
    // The BFF's health body carries a revision but no audience or scopes.
    health = jest.spyOn(gate, 'fetchJson').mockResolvedValue({ status: 200, body: { revision: 'abc123' } });
  });
  afterEach(() => { probe.mockRestore(); health.mockRestore(); });

  const row = async ({ execFile, repositoryRoot, targetKind = 'local' }) => {
    const fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const rows = await createAuditService({ fetch, adapters: { execFile, repositoryRoot }, pfProfiles: { roles: {} } }).auditRuntimeTarget({
      bffUrl: 'https://bff.example.test', gatewayUrl: 'https://gateway.example.test/mcp', authorizeUrl: 'https://authorize.example.test',
      expectedRevision: 'abc123', expectedAudienceScopes: EXPECTED, targetKind, deadlineAt: Date.now() + 5_000,
    });
    return rows.find((item) => item.id === 'runtime:audience-scope');
  };

  it('passes when the running gateway enforces the declared audience and inbound scope', async () => {
    const execFile = docker({ PG_GATEWAY_RESOURCE_ID: EXPECTED.audience, PG_INBOUND_SCOPE: 'gateway:mcp:invoke' });
    expect((await row({ execFile })).status).toBe('pass');
    expect(execFile).toHaveBeenCalledWith('docker', ['inspect', 'ai-demo-ping-gateway'], expect.any(Object));
  });

  it('fails when the gateway enforces a different audience or scope', async () => {
    expect((await row({ execFile: docker({ PG_GATEWAY_RESOURCE_ID: 'https://gateway.example.test:3006/mcp', PG_INBOUND_SCOPE: 'gateway:mcp:invoke' }) })).status).toBe('fail');
    expect((await row({ execFile: docker({ PG_GATEWAY_RESOURCE_ID: EXPECTED.audience, PG_INBOUND_SCOPE: 'gateway:mcp:invoke read' }) })).status).toBe('fail');
  });

  it('reads the generated gateway env file when there is no docker CLI', async () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-audience-'));
    fs.mkdirSync(path.join(repositoryRoot, 'ping-gateway'));
    fs.writeFileSync(path.join(repositoryRoot, 'ping-gateway/.env'), `PG_GATEWAY_RESOURCE_ID=${EXPECTED.audience}\nPG_INBOUND_SCOPE=gateway:mcp:invoke\n`);
    expect((await row({ execFile: noDocker(), repositoryRoot })).status).toBe('pass');
  });

  it('is blocked, not guessed, when the gateway settings cannot be read', async () => {
    const unreadable = [
      { execFile: jest.fn(async () => { throw new Error('permission denied'); }) },
      { execFile: noDocker(), repositoryRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-audience-')) },
      { execFile: docker({ PG_INBOUND_SCOPE: 'gateway:mcp:invoke' }) }, // no audience set
    ];
    for (const options of unreadable) {
      expect(await row(options)).toMatchObject({ status: 'blocked', evidence: 'runtime audience/scope readback unavailable' });
    }
  });

  it('does not read the local gateway for the hosted target', async () => {
    const execFile = docker({ PG_GATEWAY_RESOURCE_ID: EXPECTED.audience, PG_INBOUND_SCOPE: 'gateway:mcp:invoke' });
    expect((await row({ execFile, targetKind: 'se' })).status).toBe('blocked');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('is declared for the local target from scope-topology.json, and not for the hosted one', async () => {
    const env = {};
    for (const [target, host] of [['LOCAL', 'local.example.test'], ['SE', 'se.example.test']]) {
      Object.assign(env, { [`DEMO_READINESS_${target}_BFF_URL`]: `https://${host}`, [`DEMO_READINESS_${target}_GATEWAY_URL`]: `https://${host}/mcp`,
        [`DEMO_READINESS_${target}_AUTHORIZE_URL`]: `https://${host}/authorize`, [`DEMO_READINESS_${target}_EXPECTED_REVISION`]: 'a'.repeat(40) });
    }
    const auditTarget = jest.fn(async () => []);
    await createDefaultAdapters(Date.now, { runtimeConfig: loadDemoReadinessRuntimeConfig(env), audit: { auditTarget }, fetchImpl: jest.fn(), env: {} })
      .audit({ targets: ['local', 'se'], deadlineAt: Date.now() + 5_000, phase: 'initial' });

    const [local, hosted] = auditTarget.mock.calls.map(([call]) => call.targetConfig.runtime);
    expect(local.expectedAudienceScopes).toEqual({ audience: 'https://api.ping.demo:3036/mcp', scopes: ['gateway:mcp:invoke'] });
    expect(hosted).not.toHaveProperty('expectedAudienceScopes');
  });
});
