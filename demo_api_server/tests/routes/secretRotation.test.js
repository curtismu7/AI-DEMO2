'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/agentBuilderService', () => ({
  listApplicationsRaw: jest.fn().mockResolvedValue([
    { id: 'a1', clientId: 'c1', name: 'Rotatable', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' },
    { id: 'a2', clientId: 'worker-client-id', name: 'Worker', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
    { id: 'a3', clientId: 'c3', name: 'Public SPA', tokenEndpointAuthMethod: 'NONE' },
  ]),
}));
jest.mock('../../services/pingOneSecretRotation', () => ({
  isWorkerApp: (app) => app.clientId === 'worker-client-id',
}));

const router = require('../../routes/secretRotation');

function appWithRouter() {
  const app = express();
  app.use('/api/admin/secret-rotation', router);
  return app;
}

describe('GET /api/admin/secret-rotation/apps', () => {
  test('lists only rotatable apps — no worker, no secretless app', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(res.status).toBe(200);
    expect(res.body.apps.map((a) => a.id)).toEqual(['a1']);
  });

  test('never returns a secret field', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(JSON.stringify(res.body)).not.toMatch(/secret"\s*:/i);
  });
});
