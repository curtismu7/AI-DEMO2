// demo_api_server/tests/rfc8693Demo.route.test.js
'use strict';

const request = require('supertest');
const express = require('express');
const router = require('../routes/rfc8693Demo');

function buildApp() {
  const app = express();
  app.use('/api/demo/rfc8693', router);
  return app;
}

const VALID_BODY = {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: 'demo-subject-id-token',
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  audience: 'demo-resource-server',
};

describe('rfc8693Demo route', () => {
  test('POST /token exchanges a subject_token for an access_token', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/demo/rfc8693/token').send(VALID_BODY).expect(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(typeof res.body.access_token).toBe('string');
  });

  test('POST /token rejects an unsupported grant_type', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/rfc8693/token')
      .send({ ...VALID_BODY, grant_type: 'authorization_code' }).expect(400);
  });

  test('POST /token rejects a missing subject_token', async () => {
    const app = buildApp();
    const { subject_token, ...rest } = VALID_BODY;
    await request(app).post('/api/demo/rfc8693/token').send(rest).expect(400);
  });

  test('POST /introspect returns active:true with claims for a token this server minted', async () => {
    const app = buildApp();
    const minted = await request(app).post('/api/demo/rfc8693/token').send(VALID_BODY).expect(200);
    const res = await request(app).post('/api/demo/rfc8693/introspect')
      .send({ token: minted.body.access_token }).expect(200);
    expect(res.body.active).toBe(true);
    expect(res.body.aud).toBe('demo-resource-server');
    expect(res.body.act).toEqual({ sub: 'demo-agent' });
  });

  test('POST /introspect returns active:false for an unparseable token', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/demo/rfc8693/introspect')
      .send({ token: 'not-a-real-token' }).expect(200);
    expect(res.body.active).toBe(false);
  });

  test('POST /introspect rejects a missing token', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/rfc8693/introspect').send({}).expect(400);
  });
});
