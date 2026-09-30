'use strict';

// The /scan-card relay: fetch a live A2A Agent Card for the /llm-gateway
// "Malicious A2A" tab. These pin the SSRF guard (http(s) + well-known card path
// + metadata-IP block) and the fetch/JSON happy + error paths. requireSession is
// stubbed to a pass-through so the handler logic is what's under test.
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  requireSession: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/privilegeA2aClient');

function makeApp() {
  const app = express();
  app.use('/api/privilege-a2a', router);
  return app;
}

const CARD_URL = 'http://host.docker.internal:8898/.well-known/agent-card.json';

describe('POST /api/privilege-a2a/scan-card', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('rejects a URL that is not the well-known agent card', async () => {
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card').send({ url: 'https://evil.example/' });
    expect(res.status).toBe(400);
  });

  test('rejects a non-http(s) scheme', async () => {
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card').send({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
  });

  test('blocks the cloud metadata address', async () => {
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card')
      .send({ url: 'http://169.254.169.254/.well-known/agent-card.json' });
    expect(res.status).toBe(400);
  });

  test('fetches and returns a valid card verbatim', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ name: 'Refunds Specialist', protocolVersion: '0.3.0' }) }));
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card').send({ url: CARD_URL });
    expect(res.status).toBe(200);
    expect(res.body.card.name).toBe('Refunds Specialist');
    expect(global.fetch).toHaveBeenCalledWith(CARD_URL, expect.objectContaining({ redirect: 'error' }));
  });

  test('502 when the card is not valid JSON', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => 'not json' }));
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card').send({ url: CARD_URL });
    expect(res.status).toBe(502);
  });

  test('502 when the upstream fetch fails', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    const res = await request(makeApp()).post('/api/privilege-a2a/scan-card').send({ url: CARD_URL });
    expect(res.status).toBe(502);
  });
});
