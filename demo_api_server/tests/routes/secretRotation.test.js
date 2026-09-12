'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/agentBuilderService', () => ({
  listApplicationsRaw: jest.fn().mockResolvedValue([
    { id: 'a1', clientId: 'c1', name: 'Rotatable', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' },
    { id: 'a2', clientId: 'worker-client-id', name: 'Worker', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
    { id: 'a3', clientId: 'c3', name: 'Public SPA', tokenEndpointAuthMethod: 'NONE' },
    // Has a secret and isn't the worker, but this repo stores no vault entry
    // for it — nothing would read a rotated value, so it must not be offered.
    { id: 'a4', clientId: 'c4', name: 'Unmapped', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
  ]),
}));
jest.mock('../../services/pingOneSecretRotation', () => ({
  isWorkerApp: (app) => app.clientId === 'worker-client-id',
}));
jest.mock('../../scripts/refresh-service-envs', () => ({
  getRotatableVaultKeyMap: jest.fn().mockResolvedValue({
    c1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
    a1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
  }),
}));

const { getRotatableVaultKeyMap } = require('../../scripts/refresh-service-envs');
const router = require('../../routes/secretRotation');

function appWithRouter() {
  const app = express();
  app.use('/api/admin/secret-rotation', router);
  return app;
}

describe('GET /api/admin/secret-rotation/apps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRotatableVaultKeyMap.mockResolvedValue({
      c1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
      a1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
    });
  });

  test('lists only rotatable apps — no worker, no secretless app', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(res.status).toBe(200);
    expect(res.body.apps.map((a) => a.id)).toEqual(['a1']);
  });

  test('never returns an app whose clientId is not in the server-derived vault-key map', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(res.body.apps.map((a) => a.clientId)).not.toContain('c4');
  });

  test('carries the server-derived vaultKey so the client never invents one', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(res.body.apps[0].vaultKey).toBe('PINGONE_MCP_GATEWAY_CLIENT_SECRET');
  });

  test('never returns a secret field', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(JSON.stringify(res.body)).not.toMatch(/secret"\s*:/i);
  });
});
