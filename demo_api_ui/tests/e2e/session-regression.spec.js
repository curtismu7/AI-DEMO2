/**
 * @file session-regression.spec.js
 * @description API smoke tests for session/debug endpoints (no browser).
 *
 * Prerequisites: banking_api_server running. Override with BANKING_API_BASE.
 *
 * Run: npm run test:e2e:api  (includes this file via playwright.api.config.js)
 */

const { test, expect } = require('@playwright/test');

const API_BASE = process.env.BANKING_API_BASE || 'http://localhost:3002';

test.describe('Banking API — session & debug smoke', () => {
  test('GET /api/auth/session returns JSON (unauthenticated ok)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/session`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('authenticated');
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  test('GET /api/auth/debug returns structured JSON without 500', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/debug`);
    expect(res.status()).toBeLessThan(500);
    const body = await res.json();
    expect(body).toHaveProperty('platform');
    expect(body).toHaveProperty('sessionPresent');
    expect(body).toHaveProperty('accessTokenStub');
  });

  test('GET /api/auth/debug?deep=1 returns JSON (optional Redis probe)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/debug?deep=1`);
    expect(res.status()).toBeLessThan(500);
    const body = await res.json();
    expect(body).toHaveProperty('debugHelp');
    expect(body.debugHelp).toHaveProperty('deepProbeUsed');
  });
});
