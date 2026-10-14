'use strict';

const express = require('express');
const request = require('supertest');
const createApiCallTrackingMiddleware = require('../../middleware/apiCallTracking');

describe('global API Explorer tracking exclusions for Privilege User API Keys', () => {
  const trackApiCall = jest.fn().mockResolvedValue(undefined);
  const safeRequestLogUrl = jest.fn(req => req.originalUrl);
  const app = express();

  app.use(express.json());
  app.use('/api', createApiCallTrackingMiddleware({ trackApiCall, safeRequestLogUrl }));
  app.get('/api/privilege-user-api-keys/status', (_req, res) => res.json({ apiKeySet: true }));
  app.post('/api/privilege-user-api-keys/credentials', (_req, res) => res.json({ saved: true }));
  app.post('/api/privilege-user-api-keys/run', (_req, res) => res.json({ users: [{ email: 'private@example.test' }] }));
  app.post('/api/obo/mcp', (_req, res) => res.json({ result: 'claims' }));
  app.get('/api/example', (_req, res) => res.json({ visible: true }));

  beforeEach(() => { trackApiCall.mockClear(); safeRequestLogUrl.mockClear(); });

  test('keeps status, credential saves, and users results out of both tracker buckets', async () => {
    await request(app).get('/api/privilege-user-api-keys/status');
    await request(app).post('/api/privilege-user-api-keys/credentials').send({ api_key: 'synthetic-key' });
    await request(app).post('/api/privilege-user-api-keys/run').send({ environment_id: 'synthetic-id' });

    expect(trackApiCall).not.toHaveBeenCalled();
  });

  test('keeps case-insensitive Express route aliases out of tracking too', async () => {
    await request(app).post('/api/Privilege-User-API-Keys/run').send({ environment_id: 'synthetic-id' });

    expect(trackApiCall).not.toHaveBeenCalled();
  });

  test('keeps OBO tool results out of tracking', async () => {
    await request(app).post('/api/obo/mcp').send({});

    expect(trackApiCall).not.toHaveBeenCalled();
  });

  test('keeps tracking ordinary API responses', async () => {
    await request(app).get('/api/example');

    expect(trackApiCall).toHaveBeenCalledTimes(1);
    expect(trackApiCall).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET', responseStatus: 200, responseBody: { visible: true }, category: 'api',
    }));
  });
});
