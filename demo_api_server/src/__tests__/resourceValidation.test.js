/**
 * Tests for Resource Validation Service
 *
 * Reference: docs/PINGONE_CONFIG.md — Resource Servers section.
 * The four expected resources are Demo API, Demo Agent Gateway, Demo MCP Gateway,
 * Demo MCP Server with plain-string audience values (not URLs).
 */

const axios = require('axios');
const { validateResources, RESOURCE_REFERENCE_TABLE } = require('../../services/resourceValidationService');
const configStore = require('../../services/configStore');

jest.mock('axios');
jest.mock('../../services/configStore');
// getManagementToken is imported from pingOneClientService; mock it directly
jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn(),
}));

describe('Resource Validation Service', () => {
  const mockEnvId = '12345678-1234-1234-1234-123456789012';

  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      const k = key.toLowerCase();
      if (k === 'pingone_environment_id') return mockEnvId;
      if (k === 'pingone_region') return 'com';
      return null;
    });
    // Reset default: token succeeds
    const { getManagementToken } = require('../../services/pingOneClientService');
    getManagementToken.mockResolvedValue('mock-bearer-token');
  });

  describe('validateResources', () => {
    it('should return CORRECT for all resources when audiences match', async () => {
      const mockResources = RESOURCE_REFERENCE_TABLE.map((ref, idx) => ({
        id: `res-${idx}`,
        name: ref.name,
        audience: ref.audience,
      }));

      axios.get.mockResolvedValueOnce({ data: { resources: mockResources } });

      const result = await validateResources();

      expect(result.status).toBe('success');
      const correct = result.resourceValidation.filter((r) => r.status === 'CORRECT');
      expect(correct).toHaveLength(RESOURCE_REFERENCE_TABLE.length);
    });

    it('should detect MISSING resources when not returned by PingOne', async () => {
      // Return only the first resource
      const mockResources = [{
        id: 'res-0',
        name: RESOURCE_REFERENCE_TABLE[0].name,
        audience: RESOURCE_REFERENCE_TABLE[0].audience,
      }];

      axios.get.mockResolvedValueOnce({ data: { resources: mockResources } });

      const result = await validateResources();

      expect(result.status).toBe('success');
      const missing = result.resourceValidation.filter((r) => r.status === 'MISSING');
      expect(missing.length).toBe(RESOURCE_REFERENCE_TABLE.length - 1);
    });

    it('should detect CONFIG_ERROR when audience does not match', async () => {
      const mockResources = RESOURCE_REFERENCE_TABLE.map((ref, idx) => ({
        id: `res-${idx}`,
        name: ref.name,
        // First resource has wrong audience; rest are correct
        audience: idx === 0 ? 'wrong-audience.example.com' : ref.audience,
      }));

      axios.get.mockResolvedValueOnce({ data: { resources: mockResources } });

      const result = await validateResources();

      expect(result.status).toBe('success');
      const errors = result.resourceValidation.filter((r) => r.status === 'CONFIG_ERROR');
      expect(errors).toHaveLength(1);
      expect(errors[0].name).toBe(RESOURCE_REFERENCE_TABLE[0].name);
    });

    it('should flag UNEXPECTED resources not in the reference table', async () => {
      const mockResources = [
        ...RESOURCE_REFERENCE_TABLE.map((ref, idx) => ({
          id: `res-${idx}`,
          name: ref.name,
          audience: ref.audience,
        })),
        { id: 'res-extra', name: 'Unexpected Resource', audience: 'unexpected.example.com' },
      ];

      axios.get.mockResolvedValueOnce({ data: { resources: mockResources } });

      const result = await validateResources();

      expect(result.status).toBe('success');
      const unexpected = result.resourceValidation.filter((r) => r.status === 'UNEXPECTED');
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0].name).toBe('Unexpected Resource');
    });

    it('should handle PingOne API errors gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('PingOne API error'));

      const result = await validateResources();

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });

    it('should handle getManagementToken errors gracefully', async () => {
      const { getManagementToken } = require('../../services/pingOneClientService');
      getManagementToken.mockRejectedValueOnce(new Error('Token fetch failed'));

      const result = await validateResources();

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  describe('RESOURCE_REFERENCE_TABLE', () => {
    it('should have exactly 4 expected resources', () => {
      expect(RESOURCE_REFERENCE_TABLE).toHaveLength(4);
    });

    it('should have required fields for each resource', () => {
      RESOURCE_REFERENCE_TABLE.forEach((resource) => {
        expect(resource).toHaveProperty('name');
        expect(resource).toHaveProperty('audience');
        // expectedScopes is intentionally absent — scope validation is owned
        // by scopeAuditService (derived from scope-topology.json). Having it
        // here too created two sources of truth that could drift (CR-02).
      });
    });

    it('should use correct PingOne resource names from docs/PINGONE_CONFIG.md', () => {
      const names = RESOURCE_REFERENCE_TABLE.map((r) => r.name);
      expect(names).toContain('Demo API');
      expect(names).toContain('Demo Agent Gateway');
      expect(names).toContain('Demo MCP Gateway');
      expect(names).toContain('Demo MCP Server');
    });

    it('should use plain-string audience values (not URLs)', () => {
      const audiences = RESOURCE_REFERENCE_TABLE.map((r) => r.audience);
      expect(audiences).toContain('enduser.ping.demo');
      expect(audiences).toContain('agentgateway.ping.demo');
      expect(audiences).toContain('mcpgateway.ping.demo');
      expect(audiences).toContain('mcpserver.ping.demo');
      // Must not be URLs
      audiences.forEach((a) => {
        expect(a).not.toMatch(/^https?:\/\//);
      });
    });
  });
});
