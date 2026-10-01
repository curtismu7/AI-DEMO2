'use strict';

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' }),
}));

const express = require('express');
const request = require('supertest');
const recognizeRoutes = require('../routes/recognize');

function buildApp(authenticated = true) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    if (authenticated) req.user = { id: 'customer-1' };
    next();
  });
  app.use('/api/recognize', recognizeRoutes);
  return app;
}

describe('/api/recognize legacy route contract gate', () => {
  test('does not accept raw image enrollment or claim enrollment success', async () => {
    const res = await request(buildApp())
      .post('/api/recognize/enroll')
      .send({ imageBase64: 'private-image-data', enrolled: true });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'recognize_contract_unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('private-image-data');
  });

  test('does not invoke unsupported enrollment deletion', async () => {
    const res = await request(buildApp()).delete('/api/recognize/enroll');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'recognize_contract_unavailable' });
  });

  test('still requires authentication on the retired endpoints', async () => {
    const res = await request(buildApp(false)).post('/api/recognize/enroll').send({});
    expect(res.status).toBe(401);
  });
});
