// demo_api_server/tests/dpopDemo.route.test.js
'use strict';

const request = require('supertest');
const express = require('express');
const router = require('../routes/dpopDemo');

function buildApp() {
  const app = express();
  app.use('/api/demo/dpop', router);
  return app;
}

describe('dpopDemo route', () => {
  test('POST /token issues an access_token derived from dpop_proof', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/demo/dpop/token')
      .send({ dpop_proof: 'demo-dpop-proof-9f8a7b6c5d4e3f2a' }).expect(200);
    expect(res.body.token_type).toBe('DPoP');
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.access_token.length).toBeGreaterThan(0);
  });

  test('POST /token rejects a missing dpop_proof', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/dpop/token').send({}).expect(400);
  });

  test('POST /verify-dpop succeeds when the access_token matches the dpop_proof that minted it', async () => {
    const app = buildApp();
    const proof = 'demo-dpop-proof-9f8a7b6c5d4e3f2a';
    const minted = await request(app).post('/api/demo/dpop/token').send({ dpop_proof: proof }).expect(200);
    const res = await request(app).post('/api/demo/dpop/verify-dpop')
      .send({ access_token: minted.body.access_token, dpop_proof: proof }).expect(200);
    expect(res.body.valid).toBe(true);
  });

  test('POST /verify-dpop rejects a mismatched access_token/dpop_proof pair', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/dpop/verify-dpop')
      .send({ access_token: 'not-the-right-token', dpop_proof: 'demo-dpop-proof-9f8a7b6c5d4e3f2a' }).expect(400);
  });

  test('POST /verify-dpop rejects a missing field', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/dpop/verify-dpop').send({ access_token: 'x' }).expect(400);
  });
});
