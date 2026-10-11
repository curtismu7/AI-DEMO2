'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');

function load() {
  const axios = require('axios');
  const app = express();
  app.use(express.json());
  app.use('/api/demo/jev', require('../../routes/jev'));
  return { app, axios };
}

describe('jev gallery scenarios', () => {
  const OLD = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OLD;
  });

  test('every gallery scenario answers in simulated mode without a key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app } = load();
    for (const scenario of ['prCheck', 'uiAction', 'linkPair', 'docType', 'gameMove', 'keepTurn', 'tradeSide', 'paperTopic']) {
      const res = await request(app).post('/api/demo/jev/evaluate').send({ scenario, state: 'some state' });
      expect(res.status).toBe(200);
      expect(res.body.jev.mode).toBe('simulated');
      expect(res.body.jev.answer.type).toBeDefined();
    }
  });

  test('heuristic docType classifies a W-2 page', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app } = load();
    const res = await request(app)
      .post('/api/demo/jev/evaluate')
      .send({ scenario: 'docType', state: 'Form W-2 Wage and Tax Statement — Employer copy' });
    expect(res.body.heuristic.answer.choice).toBe('w2');
  });

  test('heuristic gameMove slides under low clearance, jumps obstacles', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app } = load();
    const slide = await request(app).post('/api/demo/jev/evaluate')
      .send({ scenario: 'gameMove', state: 'overhead beam ahead at head height' });
    expect(slide.body.heuristic.answer.choice).toBe('slide');
    const jump = await request(app).post('/api/demo/jev/evaluate')
      .send({ scenario: 'gameMove', state: 'low barrier on the track ahead' });
    expect(jump.body.heuristic.answer.choice).toBe('jump');
  });

  test('unknown scenario on batch is 400, non-array states is 400', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app } = load();
    expect((await request(app).post('/api/demo/jev/batch').send({ scenario: 'nope', states: ['a'] })).status).toBe(400);
    expect((await request(app).post('/api/demo/jev/batch').send({ scenario: 'prCheck', states: 'not-array' })).status).toBe(400);
    expect((await request(app).post('/api/demo/jev/batch').send({ scenario: 'prCheck', states: [] })).status).toBe(400);
  });

  test('batch caps at 20 states', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app } = load();
    const states = Array.from({ length: 21 }, (_, i) => `state ${i}`);
    const res = await request(app).post('/api/demo/jev/batch').send({ scenario: 'prCheck', states });
    expect(res.status).toBe(400);
  });

  test('batch in simulated mode returns one answer per state, no upstream call', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { app, axios } = load();
    const res = await request(app)
      .post('/api/demo/jev/batch')
      .send({
        scenario: 'prCheck',
        states: [
          "const API_KEY = 'sk-proj-abcdefgh12345';",
          'const label = items.length + " items";',
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.jev).toHaveLength(2);
    expect(res.body.jev[0].mode).toBe('simulated');
    expect(res.body.heuristic.answers).toHaveLength(2);
    expect(res.body.heuristic.answers[0].probability).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('batch in live mode posts each state to the scenario-locked question', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const { app, axios } = load();
    axios.post.mockImplementation(async () => ({ data: { answers: { q: { type: 'noul', noul: 0.2 } } } }));
    const res = await request(app)
      .post('/api/demo/jev/batch')
      .send({ scenario: 'prCheck', states: ['diff one', 'diff two'] });
    expect(res.status).toBe(200);
    expect(res.body.jev).toHaveLength(2);
    expect(res.body.jev.every((r) => r.answer.probability === 0.2)).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
    const [, body] = axios.post.mock.calls[0];
    expect(body.questions.q.type).toBe('noul');
    expect(body.state).toBe('diff one');
  });

  test('batch: one state failing does not fail the batch', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const { app, axios } = load();
    axios.post.mockImplementation(async (_url, body) => {
      if (body.state === 'bad') throw new Error('boom');
      return { data: { answers: { q: { type: 'noul', noul: 0.1 } } } };
    });
    const res = await request(app).post('/api/demo/jev/batch').send({ scenario: 'prCheck', states: ['good', 'bad'] });
    expect(res.status).toBe(200);
    expect(res.body.jev[0].mode).toBe('live');
    expect(res.body.jev[1].mode).toBe('error');
  });
});
