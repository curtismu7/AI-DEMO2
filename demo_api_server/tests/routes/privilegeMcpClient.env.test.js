'use strict';

/**
 * /api/privilege-mcp/env must not leak or rewrite OIDC_CLIENT_SECRET without
 * an admin session. Also: a partial PUT must not wipe existing secrets.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

describe('privilege MCP /env admin gate', () => {
  let tmpDir;
  let envPath;
  let app;
  let sessionUser;
  let sessionIsAdmin;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-mcp-env-'));
    envPath = path.join(tmpDir, 'pingone.env');
    fs.writeFileSync(
      envPath,
      [
        'SERVER_URL=https://local.ping-devops.com:8623',
        'OIDC_CLIENT_ID=client-abc',
        'OIDC_CLIENT_SECRET=super-secret',
        'OIDC_AUTH_URL=https://auth.pingone.com/env/as/authorize',
        'OIDC_TOKEN_URL=https://auth.pingone.com/env/as/token',
        'OIDC_USER_URL=https://auth.pingone.com/env/as/userinfo',
        'OIDC_SCOPES=openid profile email',
        '',
      ].join('\n'),
      'utf8'
    );

    sessionUser = null;
    sessionIsAdmin = false;

    jest.resetModules();
    process.env.MCPGW_CONFIG_PATH = tmpDir;
    const router = require('../../routes/privilegeMcpClient');
    app = express();
    app.use((req, _res, next) => {
      req.sessionID = 'privilege-env-test';
      req.session = { user: sessionUser, isAdmin: sessionIsAdmin };
      next();
    });
    app.use('/api/privilege-mcp', router);
  });

  afterEach(() => {
    delete process.env.MCPGW_CONFIG_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /env without admin session returns 401 and does not leak the secret', async () => {
    const res = await request(app).get('/api/privilege-mcp/env').expect(401);
    expect(res.body.error).toBe('admin_required');
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });

  test('PUT /env without admin session returns 401 and leaves the file unchanged', async () => {
    const before = fs.readFileSync(envPath, 'utf8');
    const res = await request(app)
      .put('/api/privilege-mcp/env')
      .send({ vars: { OIDC_CLIENT_SECRET: 'stolen' } })
      .expect(401);
    expect(res.body.error).toBe('admin_required');
    expect(fs.readFileSync(envPath, 'utf8')).toBe(before);
  });

  test('customer session cannot read or write /env', async () => {
    sessionUser = { id: 'u1', role: 'user', email: 'customer@example.com' };
    await request(app).get('/api/privilege-mcp/env').expect(401);
    await request(app)
      .put('/api/privilege-mcp/env')
      .send({ vars: { SERVER_URL: 'https://evil.example' } })
      .expect(401);
  });

  test('admin session can read /env including the client secret', async () => {
    sessionUser = { id: 'a1', role: 'admin', email: 'admin@example.com' };
    const res = await request(app).get('/api/privilege-mcp/env').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.vars.OIDC_CLIENT_SECRET).toBe('super-secret');
    expect(res.body.vars.OIDC_CLIENT_ID).toBe('client-abc');
  });

  test('admin partial PUT merges and does not wipe OIDC_CLIENT_SECRET', async () => {
    sessionUser = { id: 'a1', role: 'admin', email: 'admin@example.com' };
    const res = await request(app)
      .put('/api/privilege-mcp/env')
      .send({ vars: { SERVER_URL: 'https://local.ping-devops.com:9999' } })
      .expect(200);
    expect(res.body.vars.SERVER_URL).toBe('https://local.ping-devops.com:9999');
    expect(res.body.vars.OIDC_CLIENT_SECRET).toBe('super-secret');
    expect(res.body.vars.OIDC_CLIENT_ID).toBe('client-abc');
    const onDisk = fs.readFileSync(envPath, 'utf8');
    expect(onDisk).toContain('OIDC_CLIENT_SECRET=super-secret');
    expect(onDisk).toContain('SERVER_URL=https://local.ping-devops.com:9999');
  });
});
