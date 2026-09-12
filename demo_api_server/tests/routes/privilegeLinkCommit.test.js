'use strict';

// /internal/privilege-link/commit — the broker's confirmation that the browser
// which finished the Privilege gateway sign-in is the one that started the
// authorize. See routes/privilegeLinkCommit.js and
// docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.

const express = require('express');
const request = require('supertest');
const privilegeGatewaySession = require('../../services/privilegeGatewaySession');
const router = require('../../routes/privilegeLinkCommit');

const SECRET = 'test-privilege-link-commit-secret';
const TOKEN_URI = 'https://mcpgw.example.com/opensearch/token';

function app() {
  const a = express();
  a.use('/internal', router);
  return a;
}

describe('POST /internal/privilege-link/commit', () => {
  const originalSecret = process.env.BFF_INTERNAL_SECRET;
  beforeAll(() => { process.env.BFF_INTERNAL_SECRET = SECRET; });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.BFF_INTERNAL_SECRET;
    else process.env.BFF_INTERNAL_SECRET = originalSecret;
  });
  afterEach(() => { privilegeGatewaySession.clearAll(); });

  test('403 without the secret', async () => {
    const res = await request(app()).post('/internal/privilege-link/commit').send({ rs: 'rs-1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  test('403 with a wrong secret', async () => {
    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', 'nope')
      .send({ rs: 'rs-1' });
    expect(res.status).toBe(403);
  });

  test('400 without rs', async () => {
    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({});
    expect(res.status).toBe(400);
  });

  test('404 for an unknown rs', async () => {
    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({ rs: 'never-parked' });
    expect(res.status).toBe(404);
  });

  test('200 and the session is readable via status(app) with the right secret', async () => {
    privilegeGatewaySession.rememberPending('rs-1', {
      app: 'opensearch', accessToken: 'parked-token', tokenUri: TOKEN_URI,
    });

    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({ rs: 'rs-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ app: 'opensearch' });
    expect(privilegeGatewaySession.status('opensearch')).toEqual({ ready: true });
  });

  test('action: discard returns 204 and drops the park — a following commit 404s', async () => {
    privilegeGatewaySession.rememberPending('rs-1', {
      app: 'opensearch', accessToken: 'parked-token', tokenUri: TOKEN_URI,
    });

    const discard = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({ rs: 'rs-1', action: 'discard' });
    expect(discard.status).toBe(204);

    const commit = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({ rs: 'rs-1' });
    expect(commit.status).toBe(404);
  });

  test('discard of an unknown rs is still 204', async () => {
    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .set('x-internal-gateway-secret', SECRET)
      .send({ rs: 'never-parked', action: 'discard' });
    expect(res.status).toBe(204);
  });

  test('discard without the secret is 403', async () => {
    const res = await request(app())
      .post('/internal/privilege-link/commit')
      .send({ rs: 'rs-1', action: 'discard' });
    expect(res.status).toBe(403);
  });
});
