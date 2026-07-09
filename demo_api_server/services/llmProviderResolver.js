// banking_api_server/services/llmProviderResolver.js
/**
 * Single canonical LLM provider resolver (ARCHITECTURE-TRUTHS T-3).
 *
 * The heuristic is NOT a provider — it always runs upstream and is the
 * deterministic floor. This resolver is consulted only when the heuristic
 * did not answer.
 *
 * Rule: explicit langchainConfig.provider is honored; otherwise Helix.
 *
 * 'openai' and 'anthropic' are returned when explicitly selected
 * (pass-through). banking_agent_service (:3006) validates LLM_PROVIDER
 * and fails fast when creds are absent (config.ts VALID_LLM_PROVIDERS),
 * so a credential gate here would be dead code — selection is honored
 * and the agent service is the single point that enforces "configured".
 *
 * No other module may inline a provider default.
 *
 * @param {{ provider?: string, model?: string }} langchainConfig
 * @returns {{ provider: 'helix'|'openai'|'anthropic'|'google'|'anthropic-lmstudio'|'llamacpp'|'mlx', model: string|undefined }}
 */
function resolveLlmProvider(langchainConfig = {}) {
  const requested = langchainConfig?.provider;
  const model = langchainConfig?.model;

  if (requested === 'openai' || requested === 'anthropic' || requested === 'google') {
    // Pass-through: :3006 enforces credential presence and fails fast.
    return { provider: requested, model };
  }

  if (requested === 'anthropic-lmstudio') {
    // LM Studio Anthropic-compat endpoint — no API key required; local-only.
    return { provider: 'anthropic-lmstudio', model };
  }

  if (requested === 'llamacpp') {
    // llama.cpp — local small LLM (e.g. Gemma 3) with native tool-calling; no API key.
    // :3006 reasons via @langchain/openai against LLAMACPP_BASE_URL (llama-server /v1).
    return { provider: 'llamacpp', model };
  }

  if (requested === 'mlx') {
    // Apple mlx-lm demo server — OpenAI-compatible /v1 on MLX_LM_BASE_URL (:8098).
    return { provider: 'mlx', model };
  }

  if (requested === 'helix') return { provider: 'helix', model };

  // No explicit provider, or an unknown one → Helix (the default LLM).
  return { provider: 'helix', model };
}

module.exports = { resolveLlmProvider };
