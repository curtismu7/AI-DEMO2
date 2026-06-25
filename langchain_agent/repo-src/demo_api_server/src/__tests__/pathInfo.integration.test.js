'use strict';
/**
 * pathInfo.integration.test.js
 * Integration tests for the jwtScrubber utility + /api/path/apikey-info with real configStore.
 *
 * Test 3: scrubRawJwts({ a: 'eyJ...', b: { c: 'eyJ...' } }) returns '[REDACTED_JWT]'
 * Test 4: scrubRawJwts leaves non-JWT strings unchanged
 * Test 5: /api/path/apikey-info real configStore read → 200 with non-empty masked value
 *
 * Per CLAUDE.md two-tier test pattern: real configStore, mocked session only.
 */

const express = require('express');
const request = require('supertest');

// ─── No mock on configStore — uses real .env values (integration test) ────────

// ─── Tests 3-4: jwtScrubber unit ─────────────────────────────────────────────

describe('jwtScrubber scrubRawJwts — integration (pure unit)', () => {
  const { scrubRawJwts } = require('../../services/jwtScrubber');

  // Test 3: nested JWT strings are redacted
  it('Test 3: scrubRawJwts redacts nested JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.fakesignature';
    const input = { a: jwt, b: { c: jwt } };
    const result = scrubRawJwts(input);
    expect(result.a).toBe('[REDACTED_JWT]');
    expect(result.b.c).toBe('[REDACTED_JWT]');
  });

  // Test 4: non-JWT strings are left unchanged
  it('Test 4: scrubRawJwts leaves non-JWT strings unchanged', () => {
    const input = {
      normal: 'hello world',
      number: 42,
      nested: { msg: 'not a jwt' },
      arr: ['foo', 'bar'],
    };
    const result = scrubRawJwts(input);
    expect(result.normal).toBe('hello world');
    expect(result.number).toBe(42);
    expect(result.nested.msg).toBe('not a jwt');
    expect(result.arr).toEqual(['foo', 'bar']);
  });
});

// ─── Test 5: /api/path/apikey-info with real configStore ─────────────────────

describe('pathInfo GET /apikey-info — integration (real configStore)', () => {

  // Test 5: real configStore returns a non-empty masked value
  it('Test 5: GET /api/path/apikey-info returns 200 with non-empty apiKeyMaskedLast4', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: 'test-token' } };
      next();
    });
    const router = require('../../routes/pathInfo');
    app.use('/api/path', router);

    const res = await request(app).get('/api/path/apikey-info');
    expect(res.status).toBe(200);
    // The real configStore default is 'demo-api-key-0000' → last 4 = '0000'
    // OR the env var DEMO_APIKEY_SERVICE_KEY if set.
    // Either way, apiKeyMaskedLast4 should be a non-empty string.
    expect(res.body).toHaveProperty('apiKeyMaskedLast4');
    expect(typeof res.body.apiKeyMaskedLast4).toBe('string');
    expect(res.body.apiKeyMaskedLast4.length).toBeGreaterThan(0);
  });
});
