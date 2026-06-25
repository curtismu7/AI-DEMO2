const request = require('supertest');
const express = require('express');
const router = require('../useCases');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  // Mock authenticateToken middleware
  req.user = { id: 'test-user' };
  next();
});
app.use('/api/use-cases', router);

describe('POST /api/demo/use-cases/run', () => {
  test('Valid UC chip trigger returns 200 with metadata', async () => {
    const res = await request(app)
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'uc1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.useCaseId).toBe('uc1');
    expect(res.body.triggerText).toBeDefined();
    expect(res.body.type).toBe('chip');
    expect(res.body.message).toBe('Use case queued for execution');
  });

  test('Valid UC with triggerId returns 200', async () => {
    const res = await request(app)
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'uc1', triggerId: 'trigger-id' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('Missing useCaseId returns 400', async () => {
    const res = await request(app)
      .post('/api/use-cases/demo/run')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('useCaseId is required');
  });

  test('Invalid useCaseId returns 400', async () => {
    const res = await request(app)
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'invalid-uc' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid useCaseId');
  });

  test('Invalid triggerId returns 400', async () => {
    const res = await request(app)
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'uc1', triggerId: 'invalid-trigger' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid triggerId');
  });
});
