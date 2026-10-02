'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inProcessSettings, createDefaultAdapters } = require('../services/demoReadinessRunner');
const { createAuditService } = require('../services/demoReadinessAuditService');

const SHA = 'c'.repeat(40);
const store = (entries) => ({ getEffective: (name) => entries[name] });
const readRevision = () => SHA;

describe('a readiness run started inside the BFF', () => {
  describe('settings', () => {
    it('are process env untouched when there is no config store', () => {
      const env = { A: '1' };
      expect(inProcessSettings(env, undefined, { readRevision })).toBe(env);
    });

    it('take worker tokens and the PingFederate admin password from the vault-loaded store', () => {
      const settings = inProcessSettings({}, store({
        DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'p1-token',
        DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_TOKEN: 'pf-token',
        PF_ADMIN_CONSOLE_PASSWORD: 'admin-password',
      }), { readRevision });
      expect(settings).toMatchObject({
        DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'p1-token',
        DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_TOKEN: 'pf-token',
        PINGFEDERATE_ADMIN_PASSWORD: 'admin-password',
      });
      expect(settings).not.toHaveProperty('DEMO_READINESS_SE_PINGONE_WORKER_TOKEN');
    });

    it('fall back to the store\'s raw read when the effective read has nothing', () => {
      const raw = { getEffective: () => undefined, get: (name) => (name === 'PF_ADMIN_CONSOLE_PASSWORD' ? 'raw-password' : undefined) };
      expect(inProcessSettings({}, raw, { readRevision }).PINGFEDERATE_ADMIN_PASSWORD).toBe('raw-password');
    });

    it('derive the Authorize URL from the PingOne environment and the expected revision from the checkout', () => {
      const settings = inProcessSettings({ PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_REGION: 'eu' }, store({}), { readRevision });
      expect(settings.DEMO_READINESS_LOCAL_AUTHORIZE_URL).toBe('https://api.pingone.eu/v1/environments/env-1/decisionEndpoints');
      expect(settings.DEMO_READINESS_LOCAL_EXPECTED_REVISION).toBe(SHA);
    });

    it('never override a value process env already has, and leave the caller\'s env unchanged', () => {
      const env = {
        DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'from-env',
        DEMO_READINESS_LOCAL_AUTHORIZE_URL: 'https://declared.example/authorize',
        DEMO_READINESS_LOCAL_EXPECTED_REVISION: 'a'.repeat(40),
        PINGONE_ENVIRONMENT_ID: 'env-1',
      };
      const before = { ...env };
      const settings = inProcessSettings(env, store({ DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'from-vault' }), { readRevision });
      expect(settings).toMatchObject(before);
      expect(env).toEqual(before);
    });

    it('leave the revision unset when the checkout cannot be read', () => {
      expect(inProcessSettings({}, store({}), { readRevision: () => null })).not.toHaveProperty('DEMO_READINESS_LOCAL_EXPECTED_REVISION');
    });

    it('complete the local target and both local worker lanes from compose settings plus the store', async () => {
      const adapters = createDefaultAdapters(Date.now, {
        fetchImpl: jest.fn(async () => ({ ok: false, status: 503, text: async () => '' })),
        env: {
          DEMO_READINESS_LOCAL_BFF_URL: 'https://api.ping.demo:3001',
          DEMO_READINESS_LOCAL_GATEWAY_URL: 'https://ping-gateway:8443/mcp',
          DEMO_READINESS_LOCAL_PINGONE_WORKER_URL: 'https://readiness-worker-pingone:4443',
          DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF: 'readiness-pingone-local',
          DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_URL: 'https://readiness-worker-pingfederate:4443',
          DEMO_READINESS_LOCAL_PINGFEDERATE_IDENTITY_REF: 'readiness-pingfederate-local',
          PINGONE_ENVIRONMENT_ID: 'env-1',
          // Read from the checkout in the BFF; given here because this suite
          // may run in a linked worktree, where that read returns nothing.
          DEMO_READINESS_LOCAL_EXPECTED_REVISION: SHA,
        },
        configStore: store({
          DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'p1-token',
          DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_TOKEN: 'pf-token',
        }),
      });
      const rows = await adapters.checkPrerequisites({ targets: ['local'], deadlineAt: Date.now() + 5_000 });

      // No missing-setting row for the local target: every remaining row is a worker health probe.
      expect(rows.filter((row) => /^(target|worker):local/.test(row.id))).toEqual([]);
      expect(JSON.stringify(rows)).not.toMatch(/p1-token|pf-token/);
    });
  });

  describe('Gateway Exchange #3 without a docker CLI', () => {
    const expected = { issuer: 'https://pf.example.test:9031', tokenEndpoint: 'https://pf.example.test:9031/as/token.oauth2', clientId: 'exchanger', provenanceContains: 'ping-gateway' };
    const noDocker = () => jest.fn(async () => { throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }); });
    const repositoryWith = (lines) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-gateway-'));
      if (lines) {
        fs.mkdirSync(path.join(root, 'ping-gateway'));
        fs.writeFileSync(path.join(root, 'ping-gateway/.env'), lines.join('\n'));
      }
      return root;
    };
    const row = async (execFile, repositoryRoot) => (await createAuditService({ adapters: { execFile, repositoryRoot }, pfProfiles: { roles: {} } })
      .auditLocalDockerConfiguration({ targetId: 'local', targetKind: 'local', hostedConfig: { expected } }))[0];
    const GENERATED = ['# generated', 'PF_ISSUER_URI=https://pf.example.test:9031', 'PF_TOKEN_ENDPOINT="https://pf.example.test:9031/as/token.oauth2"',
      'PF_TE_CLIENT_ID=exchanger', 'PF_TE_CLIENT_SECRET=exchanger-secret'];

    it('compares the generated gateway env file and says that is the source', async () => {
      const result = await row(noDocker(), repositoryWith(GENERATED));
      expect(result).toMatchObject({ id: 'gateway:pf-exchange3', status: 'pass', sourceRef: expect.stringContaining('generated ping-gateway/.env') });
      expect(result.sourceRef).toContain('not the running gateway');
      expect(JSON.stringify(result)).not.toContain('exchanger-secret');
    });

    it('fails when the generated file disagrees with the declared expectation', async () => {
      const result = await row(noDocker(), repositoryWith(GENERATED.map((line) => line.replace('PF_TE_CLIENT_ID=exchanger', 'PF_TE_CLIENT_ID=someone-else'))));
      expect(result).toMatchObject({ status: 'fail', observed: { clientIdMatches: false, issuer: true } });
    });

    it('is blocked when the generated file is unreadable', async () => {
      expect(await row(noDocker(), repositoryWith(null))).toMatchObject({ status: 'blocked', evidence: expect.stringContaining('generated Gateway environment file is unreadable') });
    });

    it('does not fall back for any other docker failure', async () => {
      const failing = jest.fn(async () => { throw new Error('permission denied'); });
      const result = await row(failing, repositoryWith(GENERATED));
      expect(result).toMatchObject({ status: 'blocked', sourceRef: 'docker ps/inspect Gateway Exchange #3 environment' });
    });
  });
});
