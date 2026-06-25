const request = require('supertest');
const express = require('express');

jest.mock('child_process', () => ({
  execFile: jest.fn((_bin, _args, _opts, cb) => {
    cb(null, '{"data":[]}', '');
  }),
}));

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

  it('runs an allowed command and returns output', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'pingone_users_list' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: expect.any(String), output: expect.any(String) });
  });

  it('returns 400 if commandKey is missing', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/pingcli/commands', () => {
  it('returns array of command keys and labels', async () => {
    const res = await request(app).get('/api/admin/pingcli/commands');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
  });
});
