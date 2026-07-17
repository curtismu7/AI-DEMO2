'use strict';

const express = require('express');
const request = require('supertest');
const useCasesRouter = require('../../routes/useCases');

function makeApp() {
  const app = express();
  app.use('/api/use-cases', useCasesRouter);
  return app;
}

describe('GET /api/use-cases', () => {
  test('lists all 43 use cases, defaulting to banking', async () => {
    const res = await request(makeApp()).get('/api/use-cases');
    expect(res.status).toBe(200);
    expect(res.body.vertical).toBe('banking');
    expect(res.body.useCases).toHaveLength(43);
  });

  test('resolves per-vertical when ?vertical= is given', async () => {
    const res = await request(makeApp()).get('/api/use-cases?vertical=healthcare');
    expect(res.status).toBe(200);
    expect(res.body.vertical).toBe('healthcare');
    const uc7 = res.body.useCases.find((u) => u.id === 'UC7');
    expect(uc7.trigger.text).toBe('pay my $600 bill');
  });

  test('rejects an unknown vertical with 400', async () => {
    const res = await request(makeApp()).get('/api/use-cases?vertical=atlantis');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_vertical');
  });

  test('GET /:id returns one resolved use case', async () => {
    const res = await request(makeApp()).get('/api/use-cases/UC1');
    expect(res.status).toBe(200);
    expect(res.body.useCase.useCaseId).toBe('delegated-access-with-proof');
  });

  test('GET /:id 404s for an unknown id', async () => {
    const res = await request(makeApp()).get('/api/use-cases/UC999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_use_case');
  });
});
