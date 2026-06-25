const express = require('express');
const request = require('supertest');

describe('POST /api/langchain/helix/verify', () => {
  let app;
  let callHelixAgent;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../services/helixLlmService', () => ({
      callHelixAgent: jest.fn(),
    }));
    
    callHelixAgent = require('../../services/helixLlmService').callHelixAgent;
    const langchainConfig = require('../../routes/langchainConfig');
    
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = {}; next(); });
    app.use('/api/langchain', langchainConfig);
  });

  const validBody = {
    helix_base_url: 'https://helix.example.com',
    helix_api_key: 'testkey',
    helix_environment_id: 'env-id',
    helix_agent_id: 'my-agent',
    helix_prompt_field_id: 'textInput123',
  };

  it('returns { ok: true } when callHelixAgent resolves', async () => {
    callHelixAgent.mockResolvedValueOnce('{"kind":"none","message":"ok"}');
    const res = await request(app).post('/api/langchain/helix/verify').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns { ok: false, error } when callHelixAgent throws', async () => {
    callHelixAgent.mockRejectedValueOnce(new Error('createConversation returned null'));
    const res = await request(app).post('/api/langchain/helix/verify').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('createConversation returned null');
  });

  it('returns { ok: false, error } when required fields missing', async () => {
    const res = await request(app).post('/api/langchain/helix/verify').send({ helix_base_url: 'https://x.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/missing/i);
  });
});
