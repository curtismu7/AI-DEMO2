'use strict';

/**
 * /api/notebooklm/* — read-only proxy to the notebooklm sidecar.
 *
 * Unavailability is the expected steady state anywhere but a developer laptop
 * (the sidecar holds host Google cookies), so the reason code matters as much
 * as the status: the page names the cause instead of spinning forever.
 */

const request = require('supertest');
const express = require('express');

jest.mock('axios', () => jest.fn());
const axios = require('axios');

jest.mock('../services/notebooklmCitations', () => ({
  loadIndexes: jest.fn(() => []),
  resolveAgainst: jest.fn(() => null),
}));
const citations = require('../services/notebooklmCitations');

const notebooklmRoutes = require('../routes/notebooklmRoutes');

/** The single axios config the route passed upstream. */
function upstreamCall() {
  expect(axios).toHaveBeenCalledTimes(1);
  return axios.mock.calls[0][0];
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notebooklm', notebooklmRoutes);
  return app;
}

function axiosError(code, status) {
  const err = new Error('boom');
  if (code) err.code = code;
  if (status) err.response = { status, data: {} };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  citations.loadIndexes.mockReturnValue([]);
  citations.resolveAgainst.mockReturnValue(null);
});

describe('GET /api/notebooklm/notebooks', () => {
  it('returns the notebook list from the sidecar', async () => {
    axios.mockResolvedValue({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(200);
    expect(res.body.notebooks).toEqual([{ id: 'nb1', title: 'Ping Docs' }]);
    // The server mounts its routes under /v1; a bare /notebooks is a 404 that
    // the page would render as a generic "unavailable".
    expect(upstreamCall().url).toBe('http://notebooklm:8000/v1/notebooks');
  });

  it('calls the /v1 sources path for the selected notebook', async () => {
    axios.mockResolvedValue({ data: { sources: [{ id: 's1', title: 'PCLI guide' }] } });
    const res = await request(buildApp()).get('/api/notebooklm/notebooks/nb%201/sources');
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([{ id: 's1', title: 'PCLI guide' }]);
    expect(upstreamCall().url).toBe('http://notebooklm:8000/v1/notebooks/nb%201/sources');
  });

  it('reports sidecar_unreachable when the container is down', async () => {
    axios.mockRejectedValue(axiosError('ECONNREFUSED'));
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('sidecar_unreachable');
    expect(res.body.error).toBeDefined();
  });

  it('reports auth_expired when the sidecar rejects the session', async () => {
    axios.mockRejectedValue(axiosError(null, 401));
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('auth_expired');
  });

  it('never leaks the raw upstream error object', async () => {
    const err = axiosError(null, 500);
    err.config = { headers: { Authorization: 'Bearer super-secret' } };
    axios.mockRejectedValue(err);
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });
});

describe('POST /api/notebooklm/ask', () => {
  it('rejects a missing question with 400 and the { error } shape', async () => {
    const res = await request(buildApp()).post('/api/notebooklm/ask').send({ notebookId: 'nb1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('attaches a resolved url to each reference', async () => {
    axios.mockResolvedValue({
      data: {
        answer: 'PCLI is the agentless CLI [1].',
        references: [{ citation_number: 1, cited_text: 'the excerpt', source_id: 's1' }],
      },
    });
    citations.resolveAgainst.mockReturnValue('https://docs.pingidentity.com/privilege/x.md');

    const res = await request(buildApp())
      .post('/api/notebooklm/ask')
      .send({ notebookId: 'nb1', question: 'what is pcli?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('PCLI');
    expect(res.body.references).toEqual([
      {
        citationNumber: 1,
        citedText: 'the excerpt',
        url: 'https://docs.pingidentity.com/privilege/x.md',
      },
    ]);
  });

  // Regression: the BFF once POSTed /ask with { notebook_id, question }. No such
  // route exists on notebooklm-py 0.8.1 — the notebook is a PATH param on
  // /v1/notebooks/{id}/chat, and the browser-facing shape stays { notebookId }.
  it('POSTs the question to the notebook chat path, notebook id in the path only', async () => {
    axios.mockResolvedValue({ data: { answer: 'a', references: [] } });
    const res = await request(buildApp())
      .post('/api/notebooklm/ask')
      .send({ notebookId: 'nb1', question: 'what is pcli?' });

    expect(res.status).toBe(200);
    const call = upstreamCall();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://notebooklm:8000/v1/notebooks/nb1/chat');
    expect(call.url).not.toContain('/ask');
    expect(call.data).toEqual({ question: 'what is pcli?' });
    expect(call.data).not.toHaveProperty('notebook_id');
  });

  it('returns url null when the citation cannot be attributed', async () => {
    axios.mockResolvedValue({
      data: { answer: 'a', references: [{ citation_number: 1, cited_text: 'x', source_id: 's1' }] },
    });
    citations.resolveAgainst.mockReturnValue(null);
    const res = await request(buildApp())
      .post('/api/notebooklm/ask')
      .send({ notebookId: 'nb1', question: 'q' });
    expect(res.body.references[0].url).toBeNull();
  });
});
