'use strict';

const request = require('supertest');

const TEST_KEY = 'test-mortgage-key-9999';
process.env.API_RESOURCE_SERVER_API_KEY = TEST_KEY;

// Re-require after env is set so the module captures the right key.
const app = require('../server');

describe('banking_api_resource_server', () => {
  test('GET /health returns 200 + service identity', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('banking_api_resource_server');
    // Health is public — it must NOT leak any secret-derived material.
    expect(res.body.apiKeyLast4).toBeUndefined();
  });

  test('GET /mortgage WITHOUT X-API-Key returns 401', async () => {
    const res = await request(app).get('/mortgage');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('api_key_missing');
  });

  test('GET /mortgage WITH wrong X-API-Key returns 401', async () => {
    const res = await request(app).get('/mortgage').set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('api_key_invalid');
  });

  test('GET /mortgage WITH correct X-API-Key returns dummy mortgage data', async () => {
    const res = await request(app).get('/mortgage').set('X-API-Key', TEST_KEY);
    expect(res.status).toBe(200);
    expect(res.body.mortgage).toMatchObject({
      currency: 'USD',
    });
    expect(typeof res.body.mortgage.loanAmount).toBe('number');
    expect(typeof res.body.mortgage.currentBalance).toBe('number');
    expect(res.body.source).toBe('demo_data_service');
  });

  test('GET /unknown returns 404', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('constant-time compare: differing-length keys → 401', async () => {
    const res = await request(app).get('/mortgage').set('X-API-Key', 'short');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('api_key_invalid');
  });
});
