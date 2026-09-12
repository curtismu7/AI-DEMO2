'use strict';

const express = require('express');
const request = require('supertest');

const mockSpawn = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
jest.mock('node:child_process', () => ({ spawn: (...a) => mockSpawn(...a) }));
jest.mock('../../services/agentBuilderService', () => ({ listApplicationsRaw: jest.fn() }));
jest.mock('../../services/pingOneSecretRotation', () => ({ isWorkerApp: () => false }));

const router = require('../../routes/secretRotation');

describe('POST /api/admin/secret-rotation/start', () => {
  test('spawns the CLI detached and never puts a secret in argv', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/secret-rotation', router);

    const res = await request(app)
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'a1', vaultKey: 'DEMO_CLIENT_SECRET' });

    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [, argv, opts] = mockSpawn.mock.calls[0];
    expect(argv).toEqual(expect.arrayContaining(['--app-id', 'a1', '--vault-key', 'DEMO_CLIENT_SECRET']));
    expect(argv.join(' ')).not.toMatch(/secret=[^ ]/);
    expect(opts.detached).toBe(true);
  });

  test('rejects a request with no appId', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/secret-rotation', router);
    const res = await request(app).post('/api/admin/secret-rotation/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/appId/);
  });
});
