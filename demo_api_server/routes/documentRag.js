'use strict';

const express = require('express');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');

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
