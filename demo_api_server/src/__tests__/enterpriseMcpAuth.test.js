'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  isEnabled: jest.fn(),
  checkPolicy: jest.fn(),
  establishEnterpriseSession: jest.fn(),
  getAllowedResourceUris: jest.fn(() => ['mcpserver.ping.demo']),
}));

const configStore = require('../../services/configStore');
const enterpriseMcpPolicy = require('../../services/enterpriseMcpPolicyService');
const { EXT_ID } = require('../../services/enterpriseMcpMetadata');

describe('Enterprise MCP Auth — Phase 1 metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockReturnValue('false');
  });

  test('buildMetadata omits extensions when flag is off', () => {
    jest.isolateModules(() => {
      jest.doMock('../../services/configStore', () => ({
        getEffective: jest.fn(() => 'false'),
      }));
      const { buildMetadata } = require('../../routes/protectedResourceMetadata');
      const doc = buildMetadata({ get: () => 'localhost:3001', protocol: 'http' });
      expect(doc.extensions).toBeUndefined();
    });
  });

  test('buildMetadata includes enterprise extension when flag is on', () => {
    jest.isolateModules(() => {
      jest.doMock('../../services/configStore', () => ({
        getEffective: jest.fn((key) => (key === 'ff_enterprise_managed_mcp_auth' ? 'true' : 'false')),
      }));
      const { buildMetadata } = require('../../routes/protectedResourceMetadata');
      const doc = buildMetadata({ get: () => 'localhost:3001', protocol: 'http' });
      expect(doc.extensions).toEqual({ [EXT_ID]: {} });
    });
  });
});

describe('Enterprise MCP Auth — Phase 2 policy API contract', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.get('/policy-test', async (req, res) => {
      enterpriseMcpPolicy.isEnabled.mockReturnValue(true);
      const policy = await enterpriseMcpPolicy.checkPolicy(req);
      if (!policy.allowed) {
        return res.status(policy.httpStatus || 403).json({
          error: policy.code,
          message: policy.message,
        });
      }
      return res.json({ ok: true, matchDetail: policy.matchDetail });
    });
  });

  test('allowed group returns 200', async () => {
    enterpriseMcpPolicy.checkPolicy.mockResolvedValue({
      allowed: true,
      matchDetail: 'group:banking-agents',
    });

    const res = await request(app).get('/policy-test').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('denied group returns 403 enterprise_mcp_policy_denied', async () => {
    enterpriseMcpPolicy.checkPolicy.mockResolvedValue({
      allowed: false,
      code: 'enterprise_mcp_policy_denied',
      httpStatus: 403,
      message: 'Contact IT',
    });

    const res = await request(app).get('/policy-test').expect(403);
    expect(res.body.error).toBe('enterprise_mcp_policy_denied');
  });
});
