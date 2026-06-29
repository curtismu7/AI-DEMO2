/**
 * LLM Provider Status Service
 *
 * Checks provider availability via a lightweight health check (≤3 second timeout).
 * Returns status: 'available' | 'unreachable' | 'unconfigured'
 */
const { getLmStudioBase } = require('./lmstudioService');

/**
 * @param {string} provider
 * @param {object} config - Config object with provider settings
 * @returns {Promise<{status: string, reason: string, hasKey: boolean, isReachable: boolean}>}
 */
async function getProviderStatus(provider, config = {}) {
  const HEALTH_CHECK_TIMEOUT = 3000; // 3 seconds

  // Helix — requires 4 fields: base_url, api_key, environment_id, agent_id
  if (provider === 'helix') {
    const helixRequired = {
      helix_base_url: 'Base URL',
      helix_api_key: 'API Key',
      helix_environment_id: 'Environment ID',
      helix_agent_id: 'Agent Name'
    };
    const helixMissing = [];
    for (const field in helixRequired) {
      if (!config[field]) {
        helixMissing.push(field);
      }
    }
    if (helixMissing.length === 0) {
      return {
        status: 'available',
        reason: 'Helix credentials configured',
        hasKey: true,
        isReachable: true,
      };
    } else {
      return {
        status: 'unconfigured',
        reason: 'Helix missing: ' + helixMissing.join(', '),
        hasKey: false,
        isReachable: false,
      };
    }
  }

  // Cloud providers — available when the API key is set in the session config
  const CLOUD_PROVIDERS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY', google: 'GOOGLE_API_KEY' };
  if (CLOUD_PROVIDERS[provider]) {
    const keyField = provider + '_api_key';
    const hasKey = !!(config[keyField]);
    return {
      status: hasKey ? 'available' : 'unconfigured',
      reason: hasKey ? `${provider} API key is set` : `Set a ${CLOUD_PROVIDERS[provider]} in the LangChain config to enable ${provider}`,
      hasKey,
      isReachable: hasKey,
    };
  }

  // LM Studio (Anthropic-compat) — ping the local server; no API key required
  if (provider === 'anthropic-lmstudio') {
    const origin = getLmStudioBase();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
      const response = await fetch(`${origin}/api/v1/models`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const loaded = (data.models || []).filter(m => m.loaded_instances?.length > 0);
        const reason = loaded.length > 0
          ? `LM Studio running — ${loaded.length} model(s) loaded`
          : 'LM Studio server running (no model loaded yet)';
        return { status: 'available', reason, hasKey: true, isReachable: true };
      }
      return { status: 'unreachable', reason: `LM Studio returned ${response.status}`, hasKey: true, isReachable: false };
    } catch (err) {
      return { status: 'unreachable', reason: `LM Studio not reachable at ${origin}: ${err.message}`, hasKey: true, isReachable: false };
    }
  }

  // llama.cpp — ping llama-server's OpenAI-compatible /v1/models; no API key required.
  // 127.0.0.1 (not localhost) so Node doesn't resolve to ::1 where llama-server isn't bound.
  if (provider === 'llamacpp') {
    const origin = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
      const response = await fetch(`${origin}/v1/models`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const models = (data.data || []).map(m => m.id).filter(Boolean);
        const reason = models.length > 0
          ? `llama.cpp running — serving ${models[0]}`
          : 'llama.cpp server running (no model reported)';
        return { status: 'available', reason, hasKey: true, isReachable: true };
      }
      return { status: 'unreachable', reason: `llama.cpp returned ${response.status}`, hasKey: true, isReachable: false };
    } catch (err) {
      return { status: 'unreachable', reason: `llama.cpp not reachable at ${origin}: ${err.message} (is 'llama-server' running?)`, hasKey: true, isReachable: false };
    }
  }

  return { status: 'unconfigured', reason: `Provider "${provider}" not supported`, hasKey: false, isReachable: false };
}

module.exports = { getProviderStatus };
