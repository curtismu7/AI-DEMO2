'use strict';
/**
 * llmModels.js — the one place model IDs live in the BFF (services/ + routes/).
 *
 * Model names were spread over eight files and had drifted (claude-3-5-haiku,
 * sonnet-4-5, sonnet-4-6 all in use). scripts/check-llm-models.js (in
 * hygiene:check) fails if a model literal reappears outside this file.
 *
 * Values here are exactly what each call site used before the move — this file
 * centralises, it does not change behaviour. Bumping a model is now one edit.
 * Not covered: demo_agent_service/src/config.ts (TypeScript, own default).
 */

// Models selectable per provider (also the provider-switch allowlist — an
// unknown provider is rejected with 400).
const PROVIDER_MODELS = {
  openai:              ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic:           ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022'],
  // GroqCloud retires models without notice, and provider availability is gated
  // on GROQ_API_KEY alone (see key_set below) — so a decommissioned id here does
  // not show as "unconfigured", it passes the health check and 404s mid-request.
  // Verified against GET /openai/v1/models on 2026-08-26. qwen3.6-27b is live but
  // omitted: it emits <think> into content, which the SPA renders verbatim.
  // Google/Gemini removed from the selectable catalog 2026-10-13: the free tier
  // rate-limits under demo traffic.
  groq:                ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'groq/compound-mini'],
  helix:               ['gpt-4o', 'gpt-4o-mini', 'gemini-1.5-pro', 'claude-3-5-sonnet'],
  // LM Studio — Anthropic-compatible endpoint at /v1/messages.
  // Model IDs must match what is loaded in LM Studio (publisher/model-name format).
  'anthropic-lmstudio': ['google/gemma-4-e2b', 'google/gemma-4-e4b', 'google/gemma-3-12b-it'],
  // llama.cpp — local small LLM with native tool-calling, served by llama-server.
  // Model IDs are whatever llama-server reports via /v1/models (the model it was
  // launched with via `-m`/`-hf`). Prefer a small NON-reasoning model: NL intent +
  // short teaching answers must return under the SPA fetch timeout, which reasoning
  // models routinely blow.
  llamacpp:            ['phi-4-mini-instruct', 'gpt-oss-20b'],
  mlx:                 ['mlx-community/Phi-4-mini-instruct-4bit'],
};

const DEFAULT_MODELS = {
  openai:              'gpt-4o-mini',
  anthropic:           'claude-3-5-haiku-20241022',
  groq:                'openai/gpt-oss-20b',
  helix:               'gpt-4o-mini',
  'anthropic-lmstudio': 'google/gemma-4-e2b',
  llamacpp:            'phi-4-mini-instruct',
  mlx:                 'mlx-community/Phi-4-mini-instruct-4bit',
};

// agentBuilder's per-provider defaults (includes google, which is not selectable above).
const AGENT_BUILDER_MODELS = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  groq:      'openai/gpt-oss-20b',
  google:    'gemini-2.5-flash-lite',
  helix:     'gpt-4o-mini',
};

// gemini-2.0-flash and the 1.5 models are retired for the demo's key (404); these three
// were listed by the key's models endpoint and answered on 2026-10-05. Lite is the default:
// this call has a 12 s budget and a tiny JSON task, and Lite answered 8 of 8 runs in under
// 2 s while 2.5-flash took about 12 s on 2 of 4 runs even with thinking off.
const GEMINI_DEFAULT = 'gemini-2.5-flash-lite';
/** Models to try when the preferred model hits free-tier quota (429). */
const GEMINI_FALLBACKS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'];

// privilegeLlmProxyService defaults per upstream.
const PRIVILEGE_PROXY = {
  google:    'gemini-2.0-flash',
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
};

// One-off call sites that previously hardcoded a model.
const ANTHROPIC_NL = 'claude-sonnet-4-6';      // geminiNlIntent, platformAgentRuntime, summarizationQueue
const OPENAI_RESPONSES = 'gpt-4o';             // platformAgentRuntime (Responses API)
const SESSION_FALLBACK = 'gpt-4o-mini';        // mcpToolPipeline log label when session has no model

module.exports = {
  PROVIDER_MODELS,
  DEFAULT_MODELS,
  AGENT_BUILDER_MODELS,
  GEMINI_DEFAULT,
  GEMINI_FALLBACKS,
  PRIVILEGE_PROXY,
  ANTHROPIC_NL,
  OPENAI_RESPONSES,
  SESSION_FALLBACK,
};
