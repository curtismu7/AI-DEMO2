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
 * Ports of the tiers the default stack actually starts.
 *
 * modelCatalog.js is the SSOT and marks opt-in tiers `experimental: true` —
 * start-local-models.sh does not launch them and their GGUF is not in the
 * standard download set, but the router still knows them, so /status lists
 * them as UNHEALTHY forever. Counting those produced "2/3 healthy" on a stack
 * where 3/3 is unreachable: a permanent phantom failure on a pass card.
 *
 * Resolved from the same path llamacppModelsService.js uses (the BFF image
 * copies modelCatalog.js to /demo_llm_proxy). null = catalog unavailable, in
 * which case every reported model is counted, as before.
 * @returns {Set<number>|null}
 */
function expectedTierPorts() {
  try {
    const { TIERS } = require('../../../demo_llm_proxy/modelCatalog');
    return new Set(TIERS.filter((t) => !t.experimental).map((t) => t.port));
  } catch (_) {
    return null;
  }
}

/**
 * Split the proxy's model list into the tiers this deployment expects to be
 * running and the opt-in ones it does not. Falls back to counting everything
 * when no model carries a port we recognise — a proxy that reports a different
 * shape must not silently reduce the check to zero models.
 * @param {{ name?: string, port?: number }[]} models
 */
function splitExpected(models) {
  const ports = expectedTierPorts();
  if (!ports) return { counted: models, optIn: [] };
  const counted = models.filter((m) => ports.has(m.port));
  if (!counted.length) return { counted: models, optIn: [] };
  return { counted, optIn: models.filter((m) => !ports.has(m.port)) };
}

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

    const { counted, optIn } = splitExpected(models);
    const healthy = counted.filter((m) => m.healthy).length;
    const required = findRequiredModel(models, REQUIRED_MODEL);
    const optInNames = optIn.map((m) => String(m.name || m.port));
    // meta.models stays the full list — the card still shows every tier the
    // proxy knows; only the score is scoped to the ones expected to be running.
    const meta = { models, requiredModel: REQUIRED_MODEL, optInModels: optInNames };

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
          `Required model ${REQUIRED_MODEL} unhealthy (${healthy}/${counted.length} healthy; `
          + `tier-manager ${tm}). Fix: LLAMA_ARG_HOST=0.0.0.0 bash demo_llm_proxy/start-local-models.sh ensure 8091 `
          + `and ensure host tier-manager has LLM_PROXY_RESIDENT_TIERS (./run-docker.sh llamacpp restart).`,
        meta: { ...meta, tierManager: tm },
      };
    }

    return {
      status: healthy ? 'pass' : 'warn',
      detail: `${healthy}/${counted.length} model(s) loaded/healthy`
        + (optInNames.length ? ` (not counted, opt-in tier not started: ${optInNames.join(', ')})` : ''),
      meta,
    };
  },
};

register(status);
module.exports = { status, findRequiredModel, splitExpected };
