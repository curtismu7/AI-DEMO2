'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => 'false'),
  setRaw: jest.fn(async () => {}),
}));

const request = require('supertest');
const express = require('express');
const configStore = require('../services/configStore');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/demo-flags', require('../routes/demoFlags'));
  return app;
}

describe('POST /api/demo-flags/enable', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing useCaseId returns 400', async () => {
    const res = await request(buildApp()).post('/api/demo-flags/enable').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('unknown useCaseId returns 404', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  test('a real 2-flag use case enables exactly its resolved flags, nothing else', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_rar: 'true' });
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
    expect(configStore.setRaw).toHaveBeenCalledTimes(2);
  });

  test('a single-flag use case enables only that flag', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ciba_enabled', 'ff_mcp_gateway_pinggateway'].sort());
  });

  test('a flag that is already on is reported but not re-set', async () => {
    configStore.getEffective.mockImplementation((id) => (id === 'ff_rar' ? 'true' : 'false'));
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledTimes(1);
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
  });

  test('no session/auth header required (guest-safe)', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
