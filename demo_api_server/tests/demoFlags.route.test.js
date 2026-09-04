'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => 'false'),
  setRaw: jest.fn(async () => {}),
}));

jest.mock('../routes/featureFlags', () => ({
  pushEnterpriseMcpAuthToGateway: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/demo-flags', require('../routes/demoFlags'));
  const configStore = require('../services/configStore'); // fresh require, same generation as route above
  return { app, configStore };
}

describe('POST /api/demo-flags/enable', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing useCaseId returns 400', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/demo-flags/enable').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('unknown useCaseId returns 404', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  test('a real 2-flag use case enables exactly its resolved flags, nothing else', async () => {
    const { app, configStore } = buildApp();
    const res = await request(app)
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
    const { app, configStore } = buildApp();
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ciba_enabled', 'ff_mcp_gateway_pinggateway'].sort());
    expect(configStore.setRaw).toHaveBeenCalledTimes(2);
    expect(configStore.setRaw).toHaveBeenCalledWith({ ciba_enabled: 'true' });
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
  });

  test('a flag that is already on is reported but not re-set', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation((id) => (id === 'ff_rar' ? 'true' : 'false'));
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledTimes(1);
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
  });

  test('no session/auth header required (guest-safe)', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('a configStore.setRaw rejection returns 500 with an error field, not a hang', async () => {
    const { app, configStore } = buildApp();
    configStore.setRaw.mockRejectedValueOnce(new Error('store unavailable'));
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  test('enabling enterprise-managed-mcp-access pushes the flag to the gateway', async () => {
    const { app } = buildApp();
    const { pushEnterpriseMcpAuthToGateway } = require('../routes/featureFlags');
    const res = await request(app)
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'enterprise-managed-mcp-access' });
    expect(res.status).toBe(200);
    expect(pushEnterpriseMcpAuthToGateway).toHaveBeenCalledWith(true);
  });
});

describe('POST /api/demo-flags/disable', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing useCaseId returns 400', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/demo-flags/disable').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('unknown useCaseId returns 404', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  test('a real 2-flag use case disables exactly its resolved flags, nothing else', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation(() => 'true');
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_rar: 'false' });
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'false' });
    expect(configStore.setRaw).toHaveBeenCalledTimes(2);
  });

  test('a flag that is already off is reported but not re-set', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation((id) => (id === 'ff_rar' ? 'false' : 'true'));
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledTimes(1);
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'false' });
  });

  test('no session/auth header required (guest-safe)', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation(() => 'true');
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('a configStore.setRaw rejection returns 500 with an error field, not a hang', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation(() => 'true');
    configStore.setRaw.mockRejectedValueOnce(new Error('store unavailable'));
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  test('disabling enterprise-managed-mcp-access pushes the flag off to the gateway', async () => {
    const { app, configStore } = buildApp();
    configStore.getEffective.mockImplementation(() => 'true');
    const { pushEnterpriseMcpAuthToGateway } = require('../routes/featureFlags');
    const res = await request(app)
      .post('/api/demo-flags/disable')
      .send({ useCaseId: 'enterprise-managed-mcp-access' });
    expect(res.status).toBe(200);
    expect(pushEnterpriseMcpAuthToGateway).toHaveBeenCalledWith(false);
  });
});
