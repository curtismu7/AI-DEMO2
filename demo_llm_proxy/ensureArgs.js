// demo_llm_proxy/ensureArgs.js
'use strict';

/**
 * Resolve start-local-models.sh args for a tier-manager /ensure request.
 *
 * Without residency: classic swap (`ensure <port>` — stops every other tier).
 * With residency: `ensure-set` of the resident ports plus the requested port
 * so a gpt-oss request cannot evict the BFF's phi tier.
 *
 * @param {string|number} port
 * @param {string} [residentCsv] comma-separated ports (LLM_PROXY_RESIDENT_TIERS)
 * @returns {string[]} argv after the script path, e.g. ['ensure','8091']
 */
function parseResidentPorts(residentCsv) {
  return String(residentCsv || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\d+$/.test(p));
}

/**
 * @param {string|number} port
 * @param {string} [residentCsv]
 * @returns {string[]}
 */
function resolveEnsureArgs(port, residentCsv) {
  const portStr = String(port);
  const residents = parseResidentPorts(residentCsv);
  if (!residents.length) return ['ensure', portStr];
  return ['ensure-set', [...new Set([...residents, portStr])].join(',')];
}

module.exports = { parseResidentPorts, resolveEnsureArgs };
