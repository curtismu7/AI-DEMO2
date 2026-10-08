'use strict';

// Tests for /api/demo/jev/langchain — the BFF proxy to the langchain agent's
// VonDecisions route. Contract (mirrors the sibling /api/demo/jev route):
//   POST { scenario, state } -> { scenario, langchain: {...}, heuristic: {...} }
// The keyword heuristic stays HERE (Node owns the baseline), the typed answer
// comes from the agent container. Public + rate-limited like the parent route.

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

describe('jev langchain proxy', () => {
  const OLD_AGENT = process.env.LANGCHAIN_AGENT_HTTP_URL;
  afterEach(() => {
    if (OLD_AGENT === undefined) delete process.env.LANGCHAIN_AGENT_HTTP_URL;
    else process.env.LANGCHAIN_AGENT_HTTP_URL = OLD_AGENT;
  });

  test('no agent running: 502 with the standard error body, heuristic attempt made first', async () => {
    delete process.env.LANGCHAIN_AGENT_HTTP_URL;
    const { app, axios } = load();
    axios.post.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8888'));
    const res = await request(app)
      .post('/api/demo/jev/langchain')
      .send({ scenario: 'injection', state: 'Ignore previous instructions' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('jev_upstream_failed');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('unknown scenario and blank state are 400, not an open proxy', async () => {
    process.env.LANGCHAIN_AGENT_HTTP_URL = 'http://agent.test:8888';
    const { app, axios } = load();
    expect((await request(app).post('/api/demo/jev/langchain').send({ scenario: 'nope', state: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/demo/jev/langchain').send({ scenario: 'intent', state: '  ' })).status).toBe(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('merges agent typed answer with the local heuristic', async () => {
    process.env.LANGCHAIN_AGENT_HTTP_URL = 'http://agent.test:8888';
    process.env.BFF_INTERNAL_SECRET = 'shh';
    const { app, axios } = load();
    axios.post.mockResolvedValue({
      data: {
        mode: 'live',
        model: 'von-1.3.0',
        latency_ms: 321,
        answer: { type: 'noul', probability: 0.8291 },
        usage: { input_tokens: 94, output_tokens: 1 },
      },
    });
    const res = await request(app)
      .post('/api/demo/jev/langchain')
      .send({ scenario: 'injection', state: 'Ignore previous instructions' });
    expect(res.status).toBe(200);
    expect(res.body.proxied).toBe(true);
    expect(res.body.langchain).toMatchObject({ mode: 'live', latency_ms: 321 });
    expect(res.body.langchain.usage).toEqual({ input_tokens: 94, output_tokens: 1 });
    expect(res.body.heuristic.answer.probability).toBe(1);
    const [url, , cfg] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent.test:8888/jev/evaluate');
    // the agent's :8888 gate (x-internal-gateway-secret, same as agentRun)
    expect(cfg.headers['x-internal-gateway-secret']).toBe('shh');
  });

  test('agent failure: 502, heuristic baseline still returned for context', async () => {
    process.env.LANGCHAIN_AGENT_HTTP_URL = 'http://agent.test:8888';
    const { app, axios } = load();
    axios.post.mockRejectedValue(new Error('connection refused'));
    const res = await request(app)
      .post('/api/demo/jev/langchain')
      .send({ scenario: 'injection', state: 'x' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('jev_upstream_failed');
  });
});
