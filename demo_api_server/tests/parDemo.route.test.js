// demo_api_server/tests/parDemo.route.test.js
'use strict';

const request = require('supertest');
const express = require('express');
const router = require('../routes/parDemo');

function buildApp() {
  const app = express();
  app.use('/api/demo/par', router);
  return app;
}

describe('parDemo route', () => {
  test('POST /par issues a request_uri for a client_id + redirect_uri', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/demo/par/par')
      .send({ client_id: 'demo-par-client', redirect_uri: 'https://ai-demo.ping-devops.com/callback' }).expect(200);
    expect(res.body.request_uri).toMatch(/^urn:par:/);
    expect(res.body.expires_in).toBe(900);
  });

  test('POST /par rejects a missing redirect_uri', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/par/par').send({ client_id: 'demo-par-client' }).expect(400);
  });

  test('POST /authorize issues a code for a request_uri this server minted', async () => {
    const app = buildApp();
    const pushed = await request(app).post('/api/demo/par/par')
      .send({ client_id: 'demo-par-client', redirect_uri: 'https://ai-demo.ping-devops.com/callback' }).expect(200);
    const res = await request(app).post('/api/demo/par/authorize')
      .send({ request_uri: pushed.body.request_uri, client_id: 'demo-par-client' }).expect(200);
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThan(0);
  });

  test('POST /authorize rejects a request_uri not issued by this server', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/par/authorize')
      .send({ request_uri: 'not-a-par-uri', client_id: 'demo-par-client' }).expect(400);
  });

  test('POST /authorize rejects a missing field', async () => {
    const app = buildApp();
    await request(app).post('/api/demo/par/authorize').send({ client_id: 'demo-par-client' }).expect(400);
  });
});
