const request = require('supertest');
process.env.API_RESOURCE_SERVER_API_KEY = 'test-mortgage-key-not-default';
const app = require('../server');

describe('GET /invest', () => {
  test('401 without X-API-Key', async () => {
    const res = await request(app).get('/invest');
    expect(res.status).toBe(401);
  });
  test('200 with valid X-API-Key returns a portfolio record', async () => {
    const res = await request(app).get('/invest').set('X-API-Key', 'test-mortgage-key-not-default');
    expect(res.status).toBe(200);
    expect(res.body.invest).toBeTruthy();
    expect(res.body.invest.portfolioId).toBe('INV-8842');
    expect(res.body.authMechanism).toBe('X-API-Key (shared secret)');
  });
});
