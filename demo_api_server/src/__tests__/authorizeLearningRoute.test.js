// demo_api_server/src/__tests__/authorizeLearningRoute.test.js
'use strict';
const request = require('supertest');
const express = require('express');

// Mount only the authorize router on a bare app (mirrors authorize-routes-admin.test.js pattern).
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authorize', require('../../routes/authorize'));
  return app;
}

describe('POST /api/authorize/test-evaluate — learning demoType routing', () => {
  const app = makeApp();

  test('demoType abac (permit) returns trace + effect', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'EU', resourceRegion: 'EU', action: 'read' },
    });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('simulated-learning');
    expect(res.body.demoType).toBe('abac');
    expect(res.body.decision).toBe('PERMIT');
    expect(res.body.trace.rule).toMatch(/region/i);
  });

  test('demoType payloadFilter returns redacted output', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({
      demoType: 'payloadFilter',
      input: { role: 'teller', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.output.balance).toBeUndefined();
    expect(res.body.output.ssn).toBe('***-**-6789');
  });

  test('unknown demoType is a 400', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({ demoType: 'bogus', input: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/demoType/);
  });

  test('no demoType still requires amount+type (existing contract preserved)', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount and type/);
  });
});
