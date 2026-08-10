'use strict';

const request = require('supertest');
const express = require('express');

// The headless auto-mint hook is inert until a control-plane admin credential
// (PRIVILEGE_ADMIN_TOKEN) + a mint endpoint (PRIVILEGE_MINT_URL) are configured.
describe('privilege auto-mint hook — gating', () => {
  const KEYS = ['NODE_ENV', 'PRIVILEGE_ADMIN_TOKEN', 'PRIVILEGE_MINT_URL'];
  const saved = {};
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  function app() {
    jest.resetModules();
    const router = require('../../routes/privilegeMcpClient');
    const a = express();
    a.use('/api/privilege-mcp', router);
    return a;
  }

  it('status reports configured:false when creds are absent', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PRIVILEGE_ADMIN_TOKEN;
    delete process.env.PRIVILEGE_MINT_URL;
    const res = await request(app()).get('/api/privilege-mcp/dev/auto-mint/status').expect(200);
    expect(res.body.configured).toBe(false);
  });

  it('POST returns 501 auto_mint_unconfigured when creds are absent', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PRIVILEGE_ADMIN_TOKEN;
    delete process.env.PRIVILEGE_MINT_URL;
    const res = await request(app()).post('/api/privilege-mcp/dev/auto-mint').send({}).expect(501);
    expect(res.body.error).toBe('auto_mint_unconfigured');
  });

  it('status reports configured:true once both are set', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PRIVILEGE_ADMIN_TOKEN = 'admin-xyz';
    process.env.PRIVILEGE_MINT_URL = 'https://control-plane.example/token';
    const res = await request(app()).get('/api/privilege-mcp/dev/auto-mint/status').expect(200);
    expect(res.body.configured).toBe(true);
  });

  it('POST is 404 in production regardless of config', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PRIVILEGE_ADMIN_TOKEN = 'admin-xyz';
    process.env.PRIVILEGE_MINT_URL = 'https://control-plane.example/token';
    await request(app()).post('/api/privilege-mcp/dev/auto-mint').send({}).expect(404);
  });
});
