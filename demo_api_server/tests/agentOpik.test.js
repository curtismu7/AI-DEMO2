'use strict';

const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

const router = require('../routes/agentOpik');

const app = express();
app.use('/api/agent/opik', router);

describe('GET /api/agent/opik/*', () => {
  beforeEach(() => {
    axios.get.mockReset();
    router._clearCache();
  });

  it('forwards stats with the internal secret and returns the body', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { enabled: true, traces: 3 } });
    const res = await request(app).get('/api/agent/opik/stats?window=1h');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, traces: 3 });
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toMatch(/\/opik\/stats\?window=1h$/);
    expect(opts.headers['x-internal-gateway-secret']).toBeTruthy();
  });

  it('passes {enabled:false} through unchanged', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { enabled: false } });
    const res = await request(app).get('/api/agent/opik/traces');
    expect(res.body).toEqual({ enabled: false });
  });

  it('forwards the spans path for a trace id', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { enabled: true, spans: [] } });
    await request(app).get('/api/agent/opik/traces/01a1-b2/spans');
    expect(axios.get.mock.calls[0][0]).toMatch(/\/opik\/traces\/01a1-b2\/spans$/);
  });

  it('caches identical requests for 30s', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { enabled: true } });
    await request(app).get('/api/agent/opik/stats');
    await request(app).get('/api/agent/opik/stats');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures and answers 502 with the repo error shape', async () => {
    axios.get.mockResolvedValue({ status: 502, data: { error: 'Opik request failed' } });
    const res = await request(app).get('/api/agent/opik/stats');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('opik_unavailable');
    await request(app).get('/api/agent/opik/stats');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('answers 502 when the agent is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/api/agent/opik/stats');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('opik_unavailable');
  });

  it('maps an upstream 400 (bad window) to 400', async () => {
    axios.get.mockResolvedValue({ status: 400, data: { error: 'window must be one of 1h, 24h, 7d' } });
    const res = await request(app).get('/api/agent/opik/stats?window=9y');
    expect(res.status).toBe(400);
  });

  it('does not match unrelated paths', async () => {
    const res = await request(app).get('/api/agent/opik/../../secrets');
    expect(res.status).toBe(404);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
