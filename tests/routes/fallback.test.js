const request = require('supertest');
const app = require('../../demo_api_server/server');

describe('GET /api/fallback/chips', () => {
  it('should return retail chips when prompt indicates retail intent', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'show my orders', verticalId: 'undefined' })
      .expect(200);

    expect(response.body).toHaveProperty('chips');
    expect(response.body).toHaveProperty('verticalId');
    expect(response.body.isFallback).toBe(true);
    expect(response.body.verticalId).toBe('retail');
    expect(response.body.chips.length).toBeGreaterThan(0);
    expect(response.body.chips[0]).toHaveProperty('useCaseId');
  });

  it('should return banking chips by default', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).toBe('banking');
    expect(response.body.isFallback).toBe(true);
  });

  it('should return 400 if prompt is missing', async () => {
    await request(app)
      .get('/api/fallback/chips')
      .query({ verticalId: 'banking' })
      .expect(400);
  });
});
