const request = require('supertest');
const app = require('../../demo_api_server/server');

describe('Integration: Intent-Aware Fallback Chips', () => {
  it('should resolve retail fallback chips for retail intent ("show my orders")', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'show my orders', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).toBe('retail');
    expect(response.body.isFallback).toBe(true);
    expect(response.body.chips).toBeDefined();
    expect(response.body.chips.length).toBeGreaterThan(0);
    // All chips must have useCaseId
    expect(response.body.chips.every(c => c.useCaseId)).toBe(true);
  });

  it('should resolve sporting-goods fallback chips for sporting-goods intent ("redeem my points")', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'redeem my points', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).toBe('sporting-goods');
    expect(response.body.isFallback).toBe(true);
    expect(response.body.chips).toBeDefined();
    expect(response.body.chips.length).toBeGreaterThan(0);
    // All chips must have useCaseId
    expect(response.body.chips.every(c => c.useCaseId)).toBe(true);
  });

  it('should resolve government fallback chips for government intent ("apply for a benefit")', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'apply for a benefit', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).toBe('government');
    expect(response.body.isFallback).toBe(true);
    expect(response.body.chips).toBeDefined();
    expect(response.body.chips.length).toBeGreaterThan(0);
    // All chips must have useCaseId
    expect(response.body.chips.every(c => c.useCaseId)).toBe(true);
  });

  it('should default to banking for unrecognized intents ("hello world")', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello world', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).toBe('banking');
    expect(response.body.isFallback).toBe(true);
    expect(response.body.chips).toBeDefined();
    expect(response.body.chips.length).toBeGreaterThan(0);
    // All chips must have useCaseId
    expect(response.body.chips.every(c => c.useCaseId)).toBe(true);
  });
});
