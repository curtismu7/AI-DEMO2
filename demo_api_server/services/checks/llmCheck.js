'use strict';
const axios = require('axios');
const { register } = require('./registry');

const PROXY = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
// BFF pins this model — if it is unhealthy while the proxy is up, free chat and
// non-heuristic invoke fail with reasoning_unavailable (Docker unreachable host
// tier, or swap eviction without residency).
const REQUIRED_MODEL = process.env.LLAMACPP_MODEL || 'phi-4-mini-instruct';
const TIER_MANAGER = (process.env.TIER_MANAGER_URL || 'http://127.0.0.1:8097').replace(/\/+$/, '');

/**
 * Match proxy model name to the BFF pin (exact or substring).
 * @param {{ name?: string }[]} models
 * @param {string} required
 */
function findRequiredModel(models, required) {
  const needle = String(required || '').toLowerCase();
  if (!needle) return null;
  return (
    models.find((m) => String(m.name || '').toLowerCase() === needle)
    || models.find((m) => String(m.name || '').toLowerCase().includes(needle))
    || null
  );
}

const status = {
  id: 'llm.status', name: 'LLM models', category: 'LLM',
  severity: 'advisory',
  async run() {
    let models;
    try {
      const { data } = await axios.get(`${PROXY}/status`, { timeout: 3000 });
      models = Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      return { status: 'fail', detail: `LLM proxy unreachable: ${err.message}` };
    }
    if (!models.length) return { status: 'warn', detail: 'Proxy responded with no models', meta: { models } };

    const healthy = models.filter((m) => m.healthy).length;
    const required = findRequiredModel(models, REQUIRED_MODEL);
    const meta = { models, requiredModel: REQUIRED_MODEL };

    if (required && !required.healthy) {
      let tm = 'unknown';
      try {
        await axios.get(`${TIER_MANAGER}/health`, { timeout: 2000 });
        tm = 'up';
      } catch (_) {
        tm = 'down';
      }
      return {
        status: 'fail',
        detail:
          `Required model ${REQUIRED_MODEL} unhealthy (${healthy}/${models.length} healthy; `
          + `tier-manager ${tm}). Fix: LLAMA_ARG_HOST=0.0.0.0 bash demo_llm_proxy/start-local-models.sh ensure 8091 `
          + `and ensure host tier-manager has LLM_PROXY_RESIDENT_TIERS (./run-docker.sh llamacpp restart).`,
        meta: { ...meta, tierManager: tm },
      };
    }

    return {
      status: healthy ? 'pass' : 'warn',
      detail: `${healthy}/${models.length} model(s) loaded/healthy`,
      meta,
    };
  },
};

register(status);
module.exports = { status, findRequiredModel };
