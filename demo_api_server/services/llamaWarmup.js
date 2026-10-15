'use strict';

/**
 * Keep the local llama.cpp tier's prompt cache warm for Dot.
 *
 * The tier is CPU-bound (~20 prompt tokens/s): a cold ~1.3k-token prefix (system prompt + tools) costs about a
 * minute, a cached one ~0. The tier restarts, or another caller evicts its single slot, and the next question pays
 * the full price. This sends one throwaway question with the same prefix a real Dot call uses, so that cost is
 * paid here instead of in a demo.
 *
 * It only warms a tier that is already up: llm-proxy's /health is 503 while no tier is loaded, and the tiers swap
 * (one at a time), so poking a stopped tier would start it and stop another.
 *
 * ponytail: warms one vertical (the slot holds one prefix) and not users who carry Dot memories (those extend the
 * system prompt, so their prefix differs); upgrade by moving memories out of the system prompt.
 */

const WARM_VERTICAL = process.env.LLAMACPP_WARMUP_VERTICAL || 'airlines';
const FIRST_DELAY_MS = 30 * 1000;
const EVERY_MS = 5 * 60 * 1000;

// Same tool list + system prompt the reason loop builds for a non-admin user (processAgentMessage).
function buildPrefix(verticalId) {
  const verticalDispatch = require('./verticalDispatch');
  const { verticalManifest } = require('./verticalManifest');
  const manifest = verticalManifest.resolver.resolve(verticalId);
  const tools = verticalDispatch.toolSchemasFor(verticalId, { isAdmin: false }, () => []);
  const flavor = () => manifest?.agent?.systemPromptFlavor;
  const base = verticalDispatch.hasPlugin(verticalId) ? verticalDispatch.systemPromptFor(verticalId, {}, flavor) : flavor();
  const { injectKnowledge } = require('./knowledgePromptInjector');
  return { tools, systemPrompt: injectKnowledge(base, { domain: 'banking-domain' }) };
}

async function warmOnce({
  env = process.env,
  fetchFn = fetch,
  reason = (params) => require('./agentReasoningClient').runReasonLoop(params),
  prefix = () => buildPrefix(WARM_VERTICAL),
  log = console,
} = {}) {
  const base = env.LLAMACPP_BASE_URL;
  if (!base) return { warmed: false, why: 'no_llamacpp' };
  try {
    const health = await fetchFn(`${base.replace(/\/v1\/?$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) return { warmed: false, why: 'tier_down' };
  } catch (_) {
    return { warmed: false, why: 'tier_unreachable' };
  }
  const { tools, systemPrompt } = prefix();
  const started = Date.now();
  // One model call, no tool execution: the answer is thrown away, the point is the prompt the tier just read.
  const result = await reason({
    messages: [{ role: 'user', content: 'Hello' }],
    tools,
    provider: 'llamacpp',
    model: env.LLAMACPP_MODEL,
    systemPrompt,
    maxIterations: 1,
    executeTool: async () => ({ error: 'warmup' }),
  });
  const ms = Date.now() - started;
  log.log(`[llama-warmup] ${result.ok ? 'warmed' : 'failed'} in ${ms}ms (vertical ${WARM_VERTICAL})`);
  return { warmed: Boolean(result.ok), ms };
}

// Starts the schedule; call once after the server is listening. Timers are unref'd so they never hold the process.
function startLlamaWarmup(options = {}) {
  if (process.env.LLAMACPP_WARMUP === 'off' || process.env.NODE_ENV === 'test') return null;
  const run = () => warmOnce(options).catch((err) => console.warn('[llama-warmup] skipped:', err.message));
  const first = setTimeout(run, FIRST_DELAY_MS);
  const every = setInterval(run, EVERY_MS);
  first.unref();
  every.unref();
  return { stop: () => { clearTimeout(first); clearInterval(every); } };
}

module.exports = { warmOnce, startLlamaWarmup, buildPrefix };
