// banking_api_server/src/__tests__/pingoneBootstrapService.test.js
'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('../../services/pingOneClientService', () => ({
  listApplications: jest.fn(),
  listOidcApplicationsRaw: jest.fn(),
  getManagementToken: jest.fn(),
  createApplication: jest.fn(),
}));

const axios = require('axios');
const pingOneClientService = require('../../services/pingOneClientService');
const {
  planStepsFromManifest,
  probeManagementApiAccess,
  runPingOneBootstrap,
  getManagementWorkerConfigStatus,
} = require('../../services/pingoneBootstrapService');

describe('pingoneBootstrapService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('planStepsFromManifest', () => {
    it('returns steps for a minimal manifest', () => {
      const steps = planStepsFromManifest({
        version: 1,
        publicUrlTemplate: 'https://example.com',
        applications: { admin_oidc: { name: 'Admin', type: 'WEB_APP' } },
        demoUsers: [{ username: 'u1' }],
      });
      expect(steps.length).toBeGreaterThan(3);
      expect(steps.some((s) => /Manifest version 1/.test(s))).toBe(true);
      expect(steps.some((s) => /Admin/.test(s))).toBe(true);
      expect(steps.some((s) => /u1/.test(s))).toBe(true);
    });

    it('handles invalid manifest', () => {
      expect(planStepsFromManifest(null)[0]).toMatch(/Invalid manifest/);
    });
  });

  describe('probeManagementApiAccess', () => {
    it('returns ok when listApplications succeeds', async () => {
      pingOneClientService.listApplications.mockResolvedValue([{ id: '1', name: 'A', type: 'WEB_APP' }]);
      const r = await probeManagementApiAccess();
      expect(r.ok).toBe(true);
      expect(r.applicationCount).toBe(1);
    });

    it('returns ok false when listApplications throws', async () => {
      pingOneClientService.listApplications.mockRejectedValue(new Error('no creds'));
      const r = await probeManagementApiAccess();
      expect(r.ok).toBe(false);
      expect(r.error).toBe('no creds');
      expect(r.hint).toBeDefined();
    });
  });

  describe('getManagementWorkerConfigStatus', () => {
    it('returns an object with boolean flags and hint', () => {
      const s = getManagementWorkerConfigStatus();
      expect(s).toHaveProperty('managementWorkerReady');
      expect(s).toHaveProperty('environmentIdSet');
      expect(s.hint).toContain('Management');
    });
  });

  describe('runPingOneBootstrap', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('rejects invalid publicBaseUrl', async () => {
      const r = await runPingOneBootstrap({ publicBaseUrl: 'http://insecure.com' });
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('dryRun lists would_create when apps missing', async () => {
      pingOneClientService.getManagementToken.mockResolvedValue('tok');
      pingOneClientService.listOidcApplicationsRaw.mockResolvedValue([]);
      const manifest = {
        applications: {
          admin_oidc: { name: 'Admin App' },
        },
      };
      const r = await runPingOneBootstrap({
        publicBaseUrl: 'https://example.com',
        dryRun: true,
        includeUsers: false,
        manifest,
      });
      expect(r.ok).toBe(true);
      expect(r.steps.some((s) => s.action === 'would_create' && s.key === 'admin_oidc')).toBe(true);
    });

    it('skips app when name already exists', async () => {
      pingOneClientService.getManagementToken.mockResolvedValue('tok');
      pingOneClientService.listOidcApplicationsRaw.mockResolvedValue([{ id: 'x', name: 'Admin App' }]);
      const manifest = {
        applications: { admin_oidc: { name: 'Admin App' } },
      };
      const r = await runPingOneBootstrap({
        publicBaseUrl: 'https://example.com',
        dryRun: false,
        includeUsers: false,
        manifest,
      });
      expect(r.steps.some((s) => s.action === 'skipped')).toBe(true);
      expect(pingOneClientService.createApplication).not.toHaveBeenCalled();
    });
  });
});
