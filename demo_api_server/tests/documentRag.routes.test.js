const express = require('express');
const request = require('supertest');

test('POST /documents/search proxies collection-scoped retrieval', async () => {
  const previous = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [{ document_id: 'guide-1', title: 'Guide', section: 'Intro' }] }) });
  process.env.MCP_CODE_SEARCH_URL = 'http://code-search:8095';
  const app = express();
  app.use('/api/document-rag', require('../routes/documentRag'));
  const response = await request(app).post('/api/document-rag/search').send({ collection_id: 'learning-hub', query: 'OAuth' });
  expect(response.status).toBe(200);
  expect(response.body.results[0].document_id).toBe('guide-1');
  expect(global.fetch).toHaveBeenCalledWith('http://code-search:8095/documents/search', expect.objectContaining({ method: 'POST' }));
  global.fetch = previous;
});
