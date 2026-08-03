const request = require('supertest');
const app = require('../../server');

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

  it('should report an explicit no-match instead of defaulting to banking', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).not.toBe('banking');
    expect(response.body.noMatch).toBe(true);
    expect(response.body.chips).toEqual([]);
    expect(response.body.isFallback).toBe(true);
    expect(typeof response.body.message).toBe('string');
  });

  it('should not serve banking chips to a healthcare prompt it cannot match', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello', verticalId: 'healthcare' })
      .expect(200);

    expect(response.body.verticalId).toBe('healthcare');
    const tools = (response.body.chips || []).map((c) => c.tool);
    expect(tools).not.toContain('create_transfer');
    expect(tools).not.toContain('get_my_accounts');
  });

  it('should return 400 if prompt is missing', async () => {
    await request(app)
      .get('/api/fallback/chips')
      .query({ verticalId: 'banking' })
      .expect(400);
  });
});
