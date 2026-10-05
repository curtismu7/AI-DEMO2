'use strict';
/**
 * agentOpik.js — GET /api/agent/opik/{stats,traces,traces/:id/spans}
 *
 * Read-only proxy to the langchain_agent's /opik/* routes, which hold the Opik
 * key (it exists only in that container). Powers the Trace tab of the embedded
 * agent. Auth is enforced by authenticateToken at the server.js mount; the
 * upstream answers {enabled:false} when Opik is not configured. Responses are
 * cached for 30s per URL so a polling UI does not hammer Opik.
 */
const express = require('express');
const axios = require('axios');
const { internalSecret } = require('../utils/internalSecret');

const router = express.Router();
const CACHE_TTL_MS = 30000;
const cache = new Map(); // url -> { at, body }

function agentBase() {
  return process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://127.0.0.1:8888';
}

router.get(/^\/(stats|traces(?:\/[\w-]+\/spans)?)$/, async (req, res) => {
  const upstreamPath = `/opik/${req.params[0]}`;
  const qs = new URLSearchParams(req.query).toString();
  const key = upstreamPath + (qs ? `?${qs}` : '');

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json(hit.body);

  try {
    const upstream = await axios.get(agentBase() + key, {
      headers: { 'x-internal-gateway-secret': internalSecret() },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (upstream.status === 200) {
      cache.set(key, { at: Date.now(), body: upstream.data });
      return res.json(upstream.data);
    }
    // 4xx from the agent is a bad request of ours; everything else is upstream trouble.
    const status = upstream.status === 400 ? 400 : 502;
    return res.status(status).json({
      error: 'opik_unavailable',
      message: upstream.data?.error || 'Opik trace service returned an error',
    });
  } catch (err) {
    console.error('[agentOpik] upstream error:', err.message);
    return res.status(502).json({ error: 'opik_unavailable', message: 'Agent service unreachable' });
  }
});

router._clearCache = () => cache.clear();

module.exports = router;
