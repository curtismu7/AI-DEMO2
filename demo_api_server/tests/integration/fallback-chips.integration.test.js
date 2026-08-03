const request = require('supertest');
const app = require('../../server');

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

  it('should report a no-match, not banking, for unrecognized intents ("hello world")', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello world', verticalId: 'undefined' })
      .expect(200);

    expect(response.body.verticalId).not.toBe('banking');
    expect(response.body.noMatch).toBe(true);
    expect(response.body.chips).toEqual([]);
    expect(response.body.intentsConsidered).toBe(0);
    expect(typeof response.body.message).toBe('string');
  });

  it('should suggest healthcare chips, never banking ones, for an unmatched healthcare prompt', async () => {
    const response = await request(app)
      .get('/api/fallback/chips')
      .query({ prompt: 'hello world', verticalId: 'healthcare' })
      .expect(200);

    expect(response.body.verticalId).toBe('healthcare');
    const tools = [
      ...(response.body.chips || []),
      ...(response.body.suggestions || []),
    ].map((c) => c.tool);
    expect(tools).not.toContain('create_transfer');
    expect(tools).not.toContain('get_my_accounts');
  });
});
