'use strict';
/**
 * /api/notebooklm/* — read-only proxy to the notebooklm sidecar.
 *
 * Read-only is a security property, not just a scope cut: no write endpoint is
 * proxied, so an expired or hijacked Google session cannot mutate the user's
 * NotebookLM data through this page.
 *
 * The sidecar holds live Google cookies and is reachable only on the internal
 * compose network. It is absent on the SE cluster by design, so every failure
 * carries a machine-readable `reason` the page renders as a named empty state.
 */
const express = require('express');
const axios = require('axios');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { loadIndexes, resolveAgainst } = require('../services/notebooklmCitations');

const router = express.Router();

const BASE_URL = process.env.NOTEBOOKLM_URL || 'http://notebooklm:8000';
const BUNDLE_DIR = process.env.PING_DOCS_BUNDLE_DIR || '/bundles';
const TIMEOUT_MS = 60_000;

// Bundles are static once mounted; index them once rather than per request.
let cachedIndexes = null;
function indexes() {
  if (cachedIndexes === null) cachedIndexes = loadIndexes(BUNDLE_DIR);
  return cachedIndexes;
}

function callSidecar(urlPath, { method = 'GET', data } = {}) {
  const headers = {};
  if (process.env.NOTEBOOKLM_SERVER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.NOTEBOOKLM_SERVER_TOKEN}`;
  }
  return axios({ method, url: `${BASE_URL}${urlPath}`, data, headers, timeout: TIMEOUT_MS });
}

/** Map a normalized upstream error onto the reason codes the page renders. */
function failureReason(normalized) {
  if (normalized.code === 'UPSTREAM_UNREACHABLE') return 'sidecar_unreachable';
  if (normalized.code === 'UPSTREAM_TIMEOUT') return 'upstream_timeout';
  if (normalized.upstreamStatus === 401 || normalized.upstreamStatus === 403) return 'auth_expired';
  return 'upstream_error';
}

function sendFailure(res, err) {
  const normalized = normalizeAxiosError(err, { label: 'NotebookLM', timeoutMs: TIMEOUT_MS });
  return res.status(503).json({
    error: 'NotebookLM unavailable',
    reason: failureReason(normalized),
  });
}

router.get('/notebooks', async (_req, res) => {
  try {
    const upstream = await callSidecar('/notebooks');
    const list = (upstream.data && upstream.data.notebooks) || [];
    return res.json({ notebooks: list.map((n) => ({ id: n.id, title: n.title })) });
  } catch (err) {
    return sendFailure(res, err);
  }
});

router.get('/notebooks/:id/sources', async (req, res) => {
  try {
    const upstream = await callSidecar(`/notebooks/${encodeURIComponent(req.params.id)}/sources`);
    const list = (upstream.data && upstream.data.sources) || [];
    return res.json({ sources: list.map((s) => ({ id: s.id, title: s.title })) });
  } catch (err) {
    return sendFailure(res, err);
  }
});

router.post('/ask', async (req, res) => {
  const { notebookId, question } = req.body || {};
  if (!notebookId || typeof notebookId !== 'string') {
    return res.status(400).json({ error: 'notebookId is required' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const upstream = await callSidecar('/ask', {
      method: 'POST',
      data: { notebook_id: notebookId, question },
    });
    const body = upstream.data || {};
    const refs = Array.isArray(body.references) ? body.references : [];
    return res.json({
      answer: body.answer || '',
      references: refs.map((r) => ({
        citationNumber: r.citation_number,
        citedText: r.cited_text,
        url: resolveAgainst(r.cited_text, indexes()),
      })),
    });
  } catch (err) {
    return sendFailure(res, err);
  }
});

module.exports = router;
