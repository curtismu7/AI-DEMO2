// banking_api_server/tests/langchainConfig.agentMode.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => {
  const store = {};
  return {
    getEffective: jest.fn((k) => store[k]),
    setConfig: jest.fn(async (u) => Object.assign(store, u)),
    __store: store,
  };
});

describe('langchainConfig agent_mode', () => {
  let app;
  beforeEach(() => {
    jest.resetModules();
    const cs = require('../services/configStore');
    if (cs.__store) Object.keys(cs.__store).forEach((k) => {
      delete cs.__store[k];
    });
    app = express();
    app.use(express.json());
    app.use((req, _r, n) => { req.session = {}; n(); });
    app.use('/api/langchain', require('../routes/langchainConfig'));
  });

  test('POST accepts agent_mode + external_wiring and echoes resolved', async () => {
    const res = await request(app)
      .post('/api/langchain/config')
      .send({ agent_mode: 'claude', external_wiring: 'platform' });
    expect(res.status).toBe(200);
    expect(res.body.agent_mode).toBe('claude');
    expect(res.body.external_wiring).toBe('platform');
    expect(res.body.provider).toBe('anthropic');
  });

  test('external mode without external_wiring defaults to bff', async () => {
    const res = await request(app)
      .post('/api/langchain/config')
      .send({ agent_mode: 'helix_google' });
    expect(res.status).toBe(200);
    expect(res.body.agent_mode).toBe('helix_google');
    expect(res.body.external_wiring).toBe('bff');
    expect(res.body.provider).toBe('helix');
  });

  test('GET status returns agent_mode + external_wiring + mode list', async () => {
    await request(app).post('/api/langchain/config')
      .send({ agent_mode: 'heuristics' });
    const res = await request(app).get('/api/langchain/config/status');
    expect(res.status).toBe(200);
    expect(res.body.agent_mode).toBe('heuristics');
    expect(Array.isArray(res.body.agent_modes)).toBe(true);
    expect(res.body.agent_modes.map((m) => m.id)).toEqual([
      'heuristics', 'gemini', 'privilege_llm', 'llamacpp', 'mlx', 'claude', 'helix_google', 'groq',
    ]);
  });
});
