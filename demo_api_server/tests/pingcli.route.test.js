const request = require('supertest');
const express = require('express');

// getPingcliConfigPath() (routes/pingcli.js) needs these to resolve a
// --config flag; setup.js deliberately never loads real PINGONE_* secrets
// into tests. Without them, ensureAuthBootstrap() short-circuits with
// "not configured" before ever calling execFile, for every cmd.auth command.
process.env.PINGONE_ENVIRONMENT_ID = process.env.PINGONE_ENVIRONMENT_ID || 'test-env-id';
process.env.PINGONE_WORKER_CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID || 'test-client-id';
process.env.PINGONE_WORKER_CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET || 'test-client-secret';

jest.mock('child_process', () => ({
  execFile: jest.fn((_bin, _args, _opts, cb) => {
    cb(null, '{"data":[]}', '');
  }),
}));

// Capture the same mock instance the route captured at load time. setup.js
// calls jest.resetModules() after each test, so require('child_process')
// inside a test body would return a NEW mock the route never sees.
const { execFile } = require('child_process');
const pingcliRoutes = require('../routes/pingcli');

const app = express();
app.use(express.json());
app.use('/api/admin/pingcli', pingcliRoutes);

describe('POST /api/admin/pingcli/run', () => {
  it('returns 400 for unknown command', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'not-a-real-key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_command');
  });

  // Env-scoped cards run via `pingone api <uri>` (worker CC + users list is broken
  // in pingcli 1.2.0). Every allow-listed key stays runnable.
  it('runs an allowed command and returns output', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'pingone_envs_list' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: expect.any(String), output: expect.any(String) });
  });

  it('runs an env-scoped resource command via pingone api', async () => {
    execFile.mockClear();
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'pingone_users_list' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: expect.any(String), output: expect.any(String) });
    expect(res.body.command).toMatch(/pingone api environments\/.+\/users/);
    const lastCall = execFile.mock.calls[execFile.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(expect.arrayContaining(['pingone', 'api']));
    expect(lastCall[1].some((a) => String(a).includes('/users'))).toBe(true);
  });

  it('returns 400 if commandKey is missing', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/pingcli/version', () => {
  it('returns the parsed pingcli version', async () => {
    execFile.mockImplementationOnce((_bin, _args, _opts, cb) => {
      cb(null, 'pingcli version 1.1.0 (commit: 80fe2c68f075a8d430a87726854c0615ca2aaa44)\n', '');
    });
    const res = await request(app).get('/api/admin/pingcli/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: '1.1.0' });
  });

  it('returns 503 when the binary is missing', async () => {
    execFile.mockImplementationOnce((_bin, _args, _opts, cb) => {
      const err = new Error('spawn /app/bin/pingcli ENOENT');
      err.code = 'ENOENT';
      cb(err, '', '');
    });
    const res = await request(app).get('/api/admin/pingcli/version');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not installed/);
  });

  it('returns 503 when version output is unparseable', async () => {
    execFile.mockImplementationOnce((_bin, _args, _opts, cb) => {
      cb(null, 'FATAL: profile validation error\n', '');
    });
    const res = await request(app).get('/api/admin/pingcli/version');
    expect(res.status).toBe(503);
  });
});

describe('GET /api/admin/pingcli/commands', () => {
  it('returns array of command keys and labels', async () => {
    const res = await request(app).get('/api/admin/pingcli/commands');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
    expect(res.body.every((c) => c.runnable === true)).toBe(true);
  });

  it('includes setup prereqs (install / init / auth) for PingOne commands', async () => {
    const res = await request(app).get('/api/admin/pingcli/commands');
    const users = res.body.find((c) => c.key === 'pingone_users_list');
    expect(users).toBeTruthy();
    expect(users.auth).toBe(true);
    expect(users.prereqs.map((p) => p.title)).toEqual([
      'Install PingCLI',
      'Configure credentials',
      'Authenticate',
      'Run command',
    ]);
    expect(users.prereqs.find((p) => p.title === 'Authenticate').command).toBe(
      'pingcli pingone auth login'
    );
  });
});

describe('agent-skills commands', () => {
  it('lists both agent-skills commands as runnable, no auth', async () => {
    const res = await request(app).get('/api/admin/pingcli/commands');
    const list = res.body.find((c) => c.key === 'agent_skills_list');
    const install = res.body.find((c) => c.key === 'agent_skills_install');
    expect(list).toMatchObject({ runnable: true, auth: false });
    expect(install).toMatchObject({ runnable: true, auth: false });
    // No PingOne creds needed -> prereqs are just Install + Run.
    expect(list.prereqs.map((p) => p.title)).toEqual(['Install PingCLI', 'Run command']);
  });

  it('runs agent-skills list via execFile', async () => {
    execFile.mockClear();
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'agent_skills_list' });
    expect(res.status).toBe(200);
    expect(res.body.command).toBe('pingcli agent-skills list -O json');
    const args = execFile.mock.calls[execFile.mock.calls.length - 1][1];
    expect(args).toEqual(expect.arrayContaining(['agent-skills', 'list', '-O', 'json']));
  });

  it('injects a sandbox --output-dir for install but keeps the label clean', async () => {
    execFile.mockClear();
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'agent_skills_install' });
    expect(res.status).toBe(200);
    // Label a presenter copies must NOT leak the server-internal --output-dir.
    expect(res.body.command).toBe('pingcli agent-skills install pingcli-usage');
    const args = execFile.mock.calls[execFile.mock.calls.length - 1][1];
    expect(args).toEqual(expect.arrayContaining(['agent-skills', 'install', 'pingcli-usage']));
    const i = args.indexOf('--output-dir');
    expect(i).toBeGreaterThan(-1);
    expect(typeof args[i + 1]).toBe('string');
    expect(args[i + 1].length).toBeGreaterThan(0);
  });
});
