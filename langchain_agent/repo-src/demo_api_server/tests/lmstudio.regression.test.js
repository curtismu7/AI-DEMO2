// demo_api_server/tests/lmstudio.regression.test.js
/**
 * Regression tests for /api/langchain/lmstudio/* routes.
 *
 * All LM Studio HTTP calls are mocked (global.fetch).
 * configStore is mocked to return deterministic config.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'lmstudio_base_url') return 'http://localhost:1234';
    return null;
  }),
}));

// We need to mock lmstudioService which depends on configStore
jest.mock('../services/lmstudioService', () => ({
  getLmStudioBase: jest.fn(() => 'http://localhost:1234'),
  DEFAULT_LMSTUDIO_BASE: 'http://localhost:1234',
}));

const MODELS_RESPONSE = {
  models: [
    {
      key: 'google/gemma-4-e2b',
      display_name: 'Gemma 4 E2B',
      loaded_instances: [{ instance_id: 'abc123' }],
      size_bytes: 1_500_000_000,
      capabilities: ['tool_use'],
    },
    {
      key: 'qwen/qwen3.6-27b',
      display_name: 'Qwen 3.6 27B',
      loaded_instances: [],
      size_bytes: 15_000_000_000,
      capabilities: [],
    },
  ],
};

function makeApp() {
  const app = express();
  app.use(express.json());
  // Clear require cache so fresh mock state is used
  jest.resetModules();
  app.use('/api/langchain/lmstudio', require('../routes/lmstudio'));
  return app;
}

function mockFetch(responses) {
  // responses: array of { ok, status, body } consumed in order
  let idx = 0;
  global.fetch = jest.fn(async () => {
    const r = responses[idx++] || { ok: false, status: 500, body: {} };
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
    };
  });
}

afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

// ─── GET /status ─────────────────────────────────────────────────────────────

describe('GET /status', () => {
  test('returns server_running:true with model list when LM Studio responds OK', async () => {
    mockFetch([{ ok: true, status: 200, body: MODELS_RESPONSE }]);
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/status');
    expect(res.status).toBe(200);
    expect(res.body.server_running).toBe(true);
    expect(res.body.base_url).toBe('http://localhost:1234');
    expect(res.body.anthropic_endpoint).toBe('http://localhost:1234/v1/messages');
    expect(res.body.models).toHaveLength(2);
    expect(res.body.models[0]).toMatchObject({
      key: 'google/gemma-4-e2b',
      loaded: true,
    });
    expect(res.body.models[1]).toMatchObject({
      key: 'qwen/qwen3.6-27b',
      loaded: false,
    });
    expect(res.body.default_model).toBe('google/gemma-4-e2b');
  });

  test('returns server_running:false when LM Studio returns non-OK status', async () => {
    mockFetch([{ ok: false, status: 503, body: {} }]);
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/status');
    expect(res.status).toBe(200);
    expect(res.body.server_running).toBe(false);
    expect(res.body.reason).toMatch(/503/);
    expect(res.body.models).toEqual([]);
  });

  test('returns server_running:false when fetch throws (server not running)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/status');
    expect(res.status).toBe(200);
    expect(res.body.server_running).toBe(false);
    expect(res.body.reason).toMatch(/ECONNREFUSED/);
  });
});

// ─── POST /download ───────────────────────────────────────────────────────────

describe('POST /download', () => {
  test('returns download job info on success', async () => {
    mockFetch([{ ok: true, status: 200, body: { job_id: 'job-1', status: 'downloading', total_size_bytes: 1_000 } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/download').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.job_id).toBe('job-1');
    expect(res.body.model).toBe('google/gemma-4-e2b');
  });

  test('defaults to DEFAULT_MODEL when no body model provided', async () => {
    mockFetch([{ ok: true, status: 200, body: { job_id: 'job-2', status: 'downloading' } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/download').send({});
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('google/gemma-4-e2b');
  });

  test('returns error JSON without throwing when LM Studio returns non-OK', async () => {
    mockFetch([{ ok: false, status: 400, body: { error: 'Model not found' } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/download').send({ model: 'bad/model' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Model not found');
  });

  test('returns 503 when LM Studio unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/download').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/unreachable/i);
  });
});

// ─── GET /download/status ─────────────────────────────────────────────────────

describe('GET /download/status', () => {
  test('returns 400 when job_id is missing', async () => {
    global.fetch = jest.fn();
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/download/status');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/job_id/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns progress with computed progress_pct', async () => {
    mockFetch([{
      ok: true,
      status: 200,
      body: { status: 'downloading', downloaded_bytes: 500_000, total_size_bytes: 1_000_000 },
    }]);
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/download/status?job_id=job-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.progress_pct).toBe(50);
    expect(res.body.status).toBe('downloading');
  });

  test('progress_pct is null when bytes not available', async () => {
    mockFetch([{ ok: true, status: 200, body: { status: 'downloading' } }]);
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/download/status?job_id=job-1');
    expect(res.body.progress_pct).toBeNull();
  });

  test('returns error JSON without throwing when LM Studio returns non-OK', async () => {
    mockFetch([{ ok: false, status: 404, body: { error: 'Job not found' } }]);
    const app = makeApp();
    const res = await request(app).get('/api/langchain/lmstudio/download/status?job_id=bad-job');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Job not found');
  });
});

// ─── POST /load ───────────────────────────────────────────────────────────────

describe('POST /load', () => {
  test('returns ok:true with model info on success', async () => {
    mockFetch([{ ok: true, status: 200, body: { instance_id: 'inst-1', type: 'llm' } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/load').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.model).toBe('google/gemma-4-e2b');
    expect(res.body.instance_id).toBe('inst-1');
  });

  test('passes context_length when provided', async () => {
    mockFetch([{ ok: true, status: 200, body: {} }]);
    const app = makeApp();
    await request(app).post('/api/langchain/lmstudio/load').send({ model: 'google/gemma-4-e2b', context_length: 4096 });
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.context_length).toBe(4096);
  });

  test('returns error JSON without throwing when LM Studio returns non-OK', async () => {
    mockFetch([{ ok: false, status: 503, body: { error: 'Out of memory' } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/load').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Out of memory');
  });

  test('returns 503 when LM Studio unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/load').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });
});

// ─── POST /unload ─────────────────────────────────────────────────────────────

describe('POST /unload', () => {
  test('returns 400 when model is missing', async () => {
    global.fetch = jest.fn();
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/unload').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model required/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns ok:true on success', async () => {
    mockFetch([{ ok: true, status: 200, body: {} }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/unload').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.model).toBe('google/gemma-4-e2b');
  });

  test('returns error JSON without throwing when LM Studio returns non-OK', async () => {
    mockFetch([{ ok: false, status: 404, body: { error: 'Model not loaded' } }]);
    const app = makeApp();
    const res = await request(app).post('/api/langchain/lmstudio/unload').send({ model: 'google/gemma-4-e2b' });
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Model not loaded');
  });
});
