'use strict';

jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const express = require('express');
const router = require('../../routes/health');

const app = express();
app.use('/api/health', router);

describe('GET /api/health/services', () => {
  beforeEach(() => axios.get.mockReset());

  it('reports llm_proxy up and passes agent checks through', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.startsWith('http://localhost:3006')) {
        return { data: { status: 'ok', checks: { env: 'ok', prompts: 'primary' } } };
      }
      return { data: { status: 'ok' } };
    });

    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.llm_proxy).toEqual({ up: true });
    expect(res.body.services.agent_service.up).toBe(true);
    expect(res.body.services.agent_service.checks).toEqual({ env: 'ok', prompts: 'primary' });
    // Pre-existing fields unchanged
    expect(res.body.services.mcp_gateway.up).toBe(true);
    expect(res.body.services.mcp_server.up).toBe(true);
    expect(res.body.services.hitl_service.up).toBe(true);
  });

  it('reports llm_proxy down without failing the request', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes(':8090')) {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return { data: { status: 'ok' } };
    });

    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.llm_proxy.up).toBe(false);
    expect(res.body.services.llm_proxy.error).toBe('ECONNREFUSED');
  });

  it('tolerates an agent health payload without checks (older builds)', async () => {
    axios.get.mockResolvedValue({ data: { status: 'ok' } });
    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.agent_service.up).toBe(true);
    expect(res.body.services.agent_service.checks).toBeUndefined();
  });
});
