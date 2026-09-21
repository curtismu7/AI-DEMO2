'use strict';

const express = require('express');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');
const { callLlamaCpp } = require('../services/llamacppLlmService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 20 } });
const upstream = process.env.MCP_CODE_SEARCH_URL || 'http://localhost:8095';

async function proxy(res, path, options = {}) {
  try {
    const response = await fetch(`${upstream}${path}`, { ...options, signal: AbortSignal.timeout(120000) });
    const body = await response.json().catch(() => ({}));
    return res.status(response.status).json(body);
  } catch (err) {
    return res.status(503).json({ error: 'document_rag_unavailable', message: err.message });
  }
}

router.get('/documents', (req, res) => {
  const collectionId = String(req.query.collection_id || 'learning-hub');
  return proxy(res, `/documents?collection_id=${encodeURIComponent(collectionId)}`);
});

router.get('/jobs/:jobId', (req, res) => proxy(res, `/documents/jobs/${encodeURIComponent(req.params.jobId)}`));

router.post('/search', express.json(), (req, res) => {
  const { query, collection_id: collectionId = 'learning-hub', limit = 8 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'missing_query', message: 'query is required' });
  return proxy(res, '/documents/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, collection_id: collectionId, limit }),
  });
});

router.post('/answer', express.json(), async (req, res) => {
  const { query, collection_id: collectionId = 'learning-hub', limit = 6 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'missing_query', message: 'query is required' });
  try {
    const response = await fetch(`${upstream}/documents/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, collection_id: collectionId, limit }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(body);
    const results = Array.isArray(body.results) ? body.results : [];
    const citations = results.map((result, index) => ({
      index: index + 1, title: result.title || result.document_id,
      section: result.section || null, page_number: result.page_number || null,
      source_url: result.source_url || null, document_id: result.document_id,
    }));
    if (!results.length) return res.json({ answer: 'I could not find supporting passages in the indexed Learning Hub documents.', citations: [] });
    const context = results.map((result, index) => {
      const location = [result.title || result.document_id, result.section, result.page_number ? `page ${result.page_number}` : null].filter(Boolean).join(' — ');
      return `[${index + 1}] ${location}\n${String(result.text || '').slice(0, 4000)}`;
    }).join('\n\n');
    const answer = await callLlamaCpp([
      { role: 'system', content: 'Answer only from the supplied document passages. Cite every factual claim with bracket citations such as [1]. If the passages do not support the answer, say so plainly. Do not invent citations or sources.' },
      { role: 'user', content: `Question: ${query}\n\nDocument passages:\n${context}` },
    ]);
    return res.json({ answer, citations });
  } catch (err) {
    return res.status(503).json({ error: 'grounded_answer_unavailable', message: err.message });
  }
});

router.post('/index', requireAdmin, upload.array('file'), async (req, res) => {
  const collectionId = String(req.body.collection_id || 'learning-hub');
  if (!req.files?.length) return res.status(400).json({ error: 'no_files', message: 'At least one document is required' });
  const documents = req.files.map((file) => ({
    document_id: `${collectionId}:${file.originalname}`,
    title: file.originalname,
    filename: file.originalname,
    source_path: file.originalname,
    content: file.buffer.toString('base64'),
  }));
  return proxy(res, '/documents/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection_id: collectionId, documents }),
  });
});

router.delete('/documents/:documentId', requireAdmin, (req, res) => proxy(res, `/documents/${encodeURIComponent(req.params.documentId)}?collection_id=${encodeURIComponent(String(req.query.collection_id || 'learning-hub'))}`, { method: 'DELETE' }));

module.exports = router;
