// banking_api_server/services/geminiNlIntent.js
/**
 * Intent parsing — priority: HEURISTIC (instant) → Helix or LM Studio LLM fallback.
 * Heuristic handles all known commands (accounts, balance, transfer, education topics) with zero latency.
 * The LLM is only called when heuristic returns kind:'none' (unrecognized input).
 */
'use strict';

const path = require('node:path');
const { parseHeuristic, EDU, resolveVerticalRouting } = require('./nlIntentParser');

const { callHelixAgent } = require('./helixLlmService');
const configStore = require('./configStore');
const verticalDispatch = require('./verticalDispatch');

const { base: SYSTEM_BASE, themes: THEME_OVERRIDES } =
  require(path.join(__dirname, '../../docs/HELIX_AGENT_DIRECTIVES.json'));

function buildSystem(vertical) {
  // HELIX_AGENT_DIRECTIVES themes include the JSON-format rules from SYSTEM_BASE and
  // are authoritative for LLM intent routing. Check them first.
  // Plugin getSystemPrompt() is for UI labeling only — it lacks the JSON router rules.
  if (THEME_OVERRIDES[vertical]) return SYSTEM_BASE + THEME_OVERRIDES[vertical];
  if (verticalDispatch.hasPlugin(vertical)) {
    // Plugin with no directive theme yet: prepend JSON rules so Helix still outputs JSON.
    return SYSTEM_BASE + '\n\n' + verticalDispatch.systemPromptFor(vertical, {}, () => '');
  }
  return SYSTEM_BASE;
}

function buildSystemWithCtx(vertical, context) {
  const SYSTEM = buildSystem(vertical);
  if (!context.role) return SYSTEM;
  // Use vertical-neutral phrasing. The previous wording said "Admin users can
  // query ALL accounts" / "banking actions apply to their own accounts" — both
  // surfaced banking terminology AFTER the theme override, which directly
  // contradicted overrides like healthcare/retail/sporting-goods that
  // explicitly instruct "never surface banking terminology". The LLM weighs
  // later instructions more heavily, so the role note was undoing the
  // theme. Neutral wording lets the active theme stay authoritative.
  const roleNote = context.role === 'admin'
    ? 'This user has admin privileges and can query data across all users.'
    : 'This is a regular signed-in user — queries apply to their own data only.';
  return `${SYSTEM}\n\nSigned-in user: role=${context.role}${context.firstName ? `, name=${context.firstName}` : ''}. ${roleNote}`;
}


/**
 * Answer a general knowledge question using Helix when banking intent parsing fails.
 * @param {string} userMessage
 * @param {{ role?: string, firstName?: string }} [context]
 * @returns {Promise<object|null>} education result with markdown answer or null
 */
async function answerWithHelix(userMessage, context = {}) {
  try {
    // Use getEffective so committed FIELD_DEFS defaults (base_url, env_id,
    // agent_id, prompt_field_id) work for fresh clones with empty SQLite.
    // helix_api_key must still be supplied by the operator.
    const helixConfig = {
      helix_base_url: configStore.getEffective('helix_base_url'),
      helix_api_key: configStore.getEffective('helix_api_key'),
      helix_environment_id: configStore.getEffective('helix_environment_id'),
      helix_agent_id: configStore.getEffective('helix_agent_id'),
      helix_prompt_field_id: configStore.getEffective('helix_prompt_field_id'),
    };

    // Check if Helix is configured
    if (!helixConfig.helix_base_url || !helixConfig.helix_api_key) {
      console.warn('[nlIntent] Helix not configured');
      return null;
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a knowledgeable assistant for a banking demo platform. Answer the user\'s question concisely and accurately. Keep your answer to 1-2 paragraphs.',
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const answer = await callHelixAgent(helixConfig, messages);
    if (answer) {
      return {
        kind: 'education',
        education: { panel: 'general-knowledge' },
        message: answer,
      };
    }
  } catch (err) {
    // Surface err.cause — undici's generic "fetch failed" message hides the real
    // transport reason (e.g. UND_ERR_*, ECONNRESET, certificate errors).
    const cause = err?.cause;
    console.warn('[nlIntent] Helix error:', err.message,
      cause ? `| cause: ${cause.code || cause.message || String(cause)}` : '',
      cause?.cause ? `| inner: ${cause.cause.code || cause.cause.message || String(cause.cause)}` : '');
    if (err?.stack) console.warn('[nlIntent] Helix error stack:', err.stack.split('\n').slice(0, 4).join('\n'));
  }
  return null;
}

// Agent modes 'lmstudio' and 'heuristics_lmstudio' resolve to this provider.
const LMSTUDIO_PROVIDERS = new Set(['anthropic-lmstudio', 'lmstudio']);
const CLAUDE_PROVIDERS = new Set(['anthropic']);
const GOOGLE_PROVIDERS = new Set(['google']);
const LLAMACPP_PROVIDERS = new Set(['llamacpp']);
const MLX_PROVIDERS = new Set(['mlx']);

/** Conversational answer using Claude (Anthropic) — same result shape as answerWithHelix. */
async function answerWithClaude(userMessage, context = {}) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const apiKey = configStore.getEffective('anthropic_api_key') || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[nlIntent] Anthropic API key not configured');
      return null;
    }
    const domain = (typeof context.vertical === 'string' && context.vertical)
      ? context.vertical.replace(/-/g, ' ')
      : 'banking';
    const client = new Anthropic.default({ apiKey });
    const response = await client.messages.create({
      model: configStore.getEffective('anthropic_model') || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a knowledgeable assistant for a ${domain} platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.`,
      messages: [{ role: 'user', content: userMessage }],
    });
    const answer = response.content?.find((b) => b.type === 'text')?.text;
    if (answer) return { kind: 'education', education: { panel: 'general-knowledge' }, message: answer };
  } catch (err) {
    console.warn('[nlIntent] Claude error:', err.message);
  }
  return null;
}

/** Conversational answer from the local LM Studio model — same result shape as answerWithHelix. */
async function answerWithLmStudio(userMessage, context = {}) {
  try {
    const { callLmStudio } = require('./lmStudioLlmService');
    const domain = (typeof context.vertical === 'string' && context.vertical)
      ? context.vertical.replace(/-/g, ' ')
      : 'banking';
    const answer = await callLmStudio([
      {
        role: 'system',
        content: `You are a knowledgeable assistant for a ${domain} platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.`,
      },
      { role: 'user', content: userMessage },
    ]);
    if (answer) {
      return { kind: 'education', education: { panel: 'general-knowledge' }, message: answer };
    }
  } catch (err) {
    console.warn('[nlIntent] LM Studio error:', err.message);
  }
  return null;
}

/** Dispatch the conversational answer to the LLM the selected mode chose. */
// A conversational LLM can return a whitespace-only answer — truthy, so it slips
// past the `if (answer)` guards above, but it renders as a BLANK agent bubble in
// the chip UI. Normalize that to a friendly fallback so a chip never shows an
// empty message. Only touches empty/whitespace education text; actionable results
// (kind:banking/vertical) and non-empty answers pass through unchanged.
const EMPTY_ANSWER_FALLBACK =
  "I'm not sure how to help with that one. Try one of the suggested actions, or rephrase your question.";
function ensureRenderableAnswer(result) {
  if (result && result.kind === 'education'
      && (typeof result.message !== 'string' || result.message.trim() === '')) {
    return { ...result, message: EMPTY_ANSWER_FALLBACK };
  }
  return result;
}

async function answerWithLlamaCpp(userMessage, context = {}) {
  try {
    const { callLlamaCpp } = require('./llamacppLlmService');
    const systemWithCtx = buildSystemWithCtx(null, context);
    const raw = await callLlamaCpp([
      { role: 'system', content: systemWithCtx },
      { role: 'user', content: userMessage },
    ]);
    return raw || null;
  } catch (err) {
    console.warn('[nlIntent] llama.cpp conversational error:', err.message);
    return null;
  }
}

async function answerWithMlx(userMessage, context = {}) {
  try {
    const { callMlx } = require('./mlxLlmService');
    const systemWithCtx = buildSystemWithCtx(null, context);
    const raw = await callMlx([
      { role: 'system', content: systemWithCtx },
      { role: 'user', content: userMessage },
    ]);
    return raw || null;
  } catch (err) {
    console.warn('[nlIntent] mlx-lm conversational error:', err.message);
    return null;
  }
}

async function answerWithGoogle(userMessage, context = {}, langchainConfig = {}) {
  try {
    const { callGemini } = require('./googleGeminiLlmService');
    const systemWithCtx = buildSystemWithCtx(null, context);
    const answer = await callGemini([
      { role: 'system', content: systemWithCtx },
      { role: 'user', content: userMessage },
    ], langchainConfig);
    if (answer) {
      return { kind: 'education', education: { panel: 'general-knowledge' }, message: answer };
    }
  } catch (err) {
    console.warn('[nlIntent] Gemini error:', err.message);
  }
  return null;
}

async function answerConversational(userMessage, context, selectedProvider, langchainConfig = {}) {
  let result;
  if (LMSTUDIO_PROVIDERS.has(selectedProvider)) result = await answerWithLmStudio(userMessage, context);
  else if (CLAUDE_PROVIDERS.has(selectedProvider)) result = await answerWithClaude(userMessage, context);
  else if (GOOGLE_PROVIDERS.has(selectedProvider)) result = await answerWithGoogle(userMessage, context, langchainConfig);
  else if (LLAMACPP_PROVIDERS.has(selectedProvider)) result = await answerWithLlamaCpp(userMessage, context);
  else if (MLX_PROVIDERS.has(selectedProvider)) result = await answerWithMlx(userMessage, context);
  else result = await answerWithHelix(userMessage, context);
  return ensureRenderableAnswer(result);
}

/** Source tag so the UI labels the avatar correctly. */
function conversationalSource(selectedProvider) {
  if (LMSTUDIO_PROVIDERS.has(selectedProvider)) return 'lmstudio_fallback';
  if (CLAUDE_PROVIDERS.has(selectedProvider)) return 'claude_fallback';
  if (GOOGLE_PROVIDERS.has(selectedProvider)) return 'google_fallback';
  if (LLAMACPP_PROVIDERS.has(selectedProvider)) return 'llamacpp_fallback';
  if (MLX_PROVIDERS.has(selectedProvider)) return 'mlx_fallback';
  return 'helix_fallback';
}

/**
 * @param {string} message
 * @param {{ role?: string, firstName?: string }} [context] - user context for role-aware routing
 * @param {string} [provider='auto'] - 'auto' (heuristic→helix), 'helix', 'lmstudio'. See llmProviderResolver.
 * @returns {Promise<{ source: 'heuristic'|'helix'|'helix_fallback'|'lmstudio_fallback', result: object }>}
 */
async function parseNaturalLanguage(message, context = {}, provider = 'auto', langchainConfig = {}) {
  // 1. HEURISTIC ALWAYS RUNS as a deterministic safety net (zero latency).
  // ff_heuristic_enabled=false (the agent UI's "LLM only" toggle) means "prefer LLM",
  // not "disable heuristic" — if every LLM falls through, we still want the heuristic
  // answer instead of a canned "I didn't catch that" UI fallback.
  const heuristicEnabled = configStore.getEffective('ff_heuristic_enabled') !== 'false';
  // Set true once any LLM router call has been made, so heuristic-floor returns
  // reached after the LLM falls through still report llm_attempted to the UI.
  let llmAttempted = false;
  const { verticalId: activeVertical, verticalCtx: _verticalCtx } = resolveVerticalRouting(context?.vertical);
  const isAdmin = context?.role === 'admin' || context?.isAdmin === true;
  // Heuristics-only (provider:"heuristic" or agent_mode heuristics) has no LLM
  // fallthrough — allow mode=llm chip messages to match deterministic heuristics
  // instead of short-circuiting to the capability catalog.
  const { resolveAgentMode, AGENT_MODES } = require('./agentModeResolver');
  const rawAgentMode = configStore.getEffective('agent_mode');
  const resolvedAgentModeEarly = rawAgentMode
    ? resolveAgentMode(rawAgentMode, configStore.getEffective('agent_external_wiring'))
    : null;
  const heuristicsOnly =
    provider === 'heuristic' ||
    (resolvedAgentModeEarly && resolvedAgentModeEarly.mode === 'heuristics');
  const heuristicResult = parseHeuristic(message, activeVertical, _verticalCtx, {
    isAdmin,
    heuristicsOnly,
  });

  // Single concise log per /nl call — vertical + message preview + provider.
  // Surfaces in /tmp/demo-api.log for post-hoc diagnosis of routing decisions.
  const msgPreview = String(message || '').slice(0, 60).replace(/\s+/g, ' ');
  const startedAt = Date.now();
  /** Internal: log + return the resolved decision in one line. */
  function logAndReturn(out) {
    const action = out?.result?.banking?.action
      || (out?.result?.kind === 'education' ? `edu:${out.result.education?.panel || 'unknown'}` : null)
      || out?.result?.kind || 'unknown';
    const ms = Date.now() - startedAt;
    console.log(
      `[nlIntent] vertical=${activeVertical || 'none'} provider=${provider} source=${out.source} `
      + `action=${action} ms=${ms} msg="${msgPreview}"`
    );
    return out;
  }

  // provider:"heuristic" = heuristic-only mode (Quick Action chips, no LLM configured).
  // Skip LLM entirely — return immediately with heuristic result whatever it is.
  if (provider === 'heuristic') {
    return { source: 'heuristic', result: heuristicResult };
  }

  // provider:"pingone-admin" = PingOne MCP Admin chip — skip heuristic, go straight to Helix.
  if (provider === 'pingone-admin') {
    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { provider: llmProvider } = resolveLlmProvider(langchainConfig);
    if (llmProvider !== 'helix') {
      return {
        source: 'heuristic',
        result: { kind: 'none', message: 'PingOne Admin tools require Helix to be configured. Open the Helix tab in the agent and add base_url + api_key + agent_id.' },
        llm_attempted: false,
        llm_not_configured: true,
      };
    }
    // Fall through with selectedProvider forced to 'helix' below.
  }

  // agent_mode controls heuristicRouting per the five-mode spec.
  // When mode is helix_google (Helix only), bypass the heuristic fast-return
  // so the LLM path is always taken — matching heuristicRouting:false in agentModeResolver.
  // resolveAgentMode / AGENT_MODES already required above for heuristicsOnly.
  const resolvedAgentMode = resolvedAgentModeEarly;
  // If the request specifies an explicit LLM provider (not 'heuristic'/'auto'), honour
  // that provider's heuristicRouting flag even when configStore.agent_mode differs.
  // This ensures the mode-picker selection on the frontend takes precedence over the
  // persisted configStore value for the duration of this request.
  const requestModeEntry = (provider && provider !== 'heuristic' && provider !== 'auto')
    ? (AGENT_MODES || []).find(m => m.provider === provider)
    : null;
  const heuristicRoutingEnabled = requestModeEntry
    ? requestModeEntry.heuristicRouting
    : (resolvedAgentMode ? resolvedAgentMode.heuristicRouting : heuristicEnabled);

  if (provider !== 'pingone-admin' && heuristicRoutingEnabled && heuristicResult && heuristicResult.kind !== 'none') {
    return { source: 'heuristic', result: heuristicResult };
  }

  // 2. FALLBACK TO LLM — when heuristic doesn't recognize the input
  // Use configured provider (Helix, LM Studio, etc.) based on langchainConfig
  const { resolveLlmProvider } = require('./llmProviderResolver');
  const selectedProvider = (provider === 'auto' || provider === 'pingone-admin')
    ? resolveLlmProvider(langchainConfig).provider
    : provider;

  // Try selected provider first for NL intent routing
  if (selectedProvider === 'helix') {
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);

    try {
      // Use getEffective so FIELD_DEFS defaults reach fresh clones (see answerWithHelix).
      const helixConfig = {
        helix_base_url: langchainConfig.helix_base_url || configStore.getEffective('helix_base_url'),
        helix_api_key: langchainConfig.helix_api_key || configStore.getEffective('helix_api_key'),
        helix_environment_id: langchainConfig.helix_environment_id || configStore.getEffective('helix_environment_id'),
        helix_agent_id: langchainConfig.helix_agent_id || configStore.getEffective('helix_agent_id'),
        helix_prompt_field_id: langchainConfig.helix_prompt_field_id || configStore.getEffective('helix_prompt_field_id'),
      };

      // Check if Helix is configured
      if (!helixConfig.helix_base_url || !helixConfig.helix_api_key) {
        const missingField = !helixConfig.helix_api_key ? 'helix_api_key' : 'helix_base_url';
        console.warn(`[nlIntent] Helix not configured (${missingField} empty) — returning heuristic result. In helix_google mode this causes HEURISTIC label even when LLM-only is selected.`);
        return { source: 'heuristic', result: heuristicResult, llm_attempted: false, llm_not_configured: true };
      } else {
        const helixResult = await callHelixAgent(helixConfig, [
          { role: 'system', content: systemWithCtx },
          { role: 'user', content: message },
        ]);

        const tryParse = (text) => {
          if (!text) return null;
          const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
          } catch (e) {
            // not JSON — fall through to refusal-detection retry
          }
          return null;
        };

        let parsed = tryParse(helixResult);
        if (parsed) return logAndReturn({ source: 'helix', result: parsed });

        // Retry-on-refusal: when Helix returns prose (especially a refusal like
        // "I cannot fulfill that request"), nudge it to emit JSON and re-classify.
        // Detection is intentionally loose — any non-JSON response from a chip
        // phrase is a misclassification we want to fix.
        const looksLikeRefusal = helixResult &&
          /\b(cannot|can't|unable|won'?t|not able|do not have access|don't have access|this is a (banking )?demo|log in to your)\b/i.test(helixResult);
        if (helixResult && (looksLikeRefusal || !parsed)) {
          console.warn('[nlIntent] Helix returned non-JSON or refusal — retrying with explicit JSON-only nudge');
          const nudge = systemWithCtx +
            `\n\nRETRY NOTE: Your previous response was not valid JSON or was a refusal. ` +
            `You MUST output ONLY a JSON object matching one of the allowed shapes above. ` +
            `Do not refuse on privacy/demo grounds — the user is authenticated and tools work. ` +
            `If unsure, default to {"kind":"banking","banking":{"action":"spending_summary","params":{}}} ` +
            `for spending/category/percentage questions, {"action":"transactions","params":{}} for ` +
            `transaction lists, or {"action":"balance","params":{}} for balance questions.`;
          try {
            const retry = await callHelixAgent(helixConfig, [
              { role: 'system', content: nudge },
              { role: 'user', content: message },
            ]);
            parsed = tryParse(retry);
            if (parsed) return logAndReturn({ source: 'helix', result: parsed });
          } catch (e) {
            console.warn('[nlIntent] Helix retry failed:', e.message);
          }
        }
        // kind:'none' or still non-JSON — fall through to the conversational Helix
        // answer (LLM-only block below, or answerWithHelix in heuristic mode).
        // Mark that the LLM was attempted so a final heuristic-floor return can tell
        // the UI "Helix couldn't map this" (BankingAgent.js) vs a never-tried fallback.
        llmAttempted = true;
      }
    } catch (err) {
      // 401 means the cached API key is rejected — evict it so the next request
      // re-reads the key file (handles rotated or expired keys without a restart).
      if (/\b401\b/.test(err.message)) {
        try { require('./helixAgentKeyLoader').clearCache(); } catch (_) {}
      }
      console.warn('[nlIntent] Helix error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // Claude (Anthropic) JSON intent parsing — parallel to the Helix branch.
  if (CLAUDE_PROVIDERS.has(selectedProvider)) {
    const apiKey = langchainConfig?.anthropic_api_key
      || configStore.getEffective('anthropic_api_key')
      || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[nlIntent] Claude not configured (anthropic_api_key missing) — falling back to heuristic');
      return { source: 'heuristic', result: heuristicResult, llm_attempted: false, llm_not_configured: true };
    }
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });
      const model = langchainConfig?.anthropic_model
        || configStore.getEffective('anthropic_model')
        || 'claude-sonnet-4-6';
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: systemWithCtx,
        messages: [{ role: 'user', content: message }],
      });
      const rawText = response.content?.find((b) => b.type === 'text')?.text;
      const tryParse = (text) => {
        if (!text) return null;
        const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
        } catch (_) {}
        return null;
      };
      const parsed = tryParse(rawText);
      if (parsed) return logAndReturn({ source: 'claude', result: parsed });
      llmAttempted = true;
    } catch (err) {
      console.warn('[nlIntent] Claude intent error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // Google Gemini JSON intent parsing — parallel to the Claude branch.
  if (GOOGLE_PROVIDERS.has(selectedProvider)) {
    const apiKey = langchainConfig?.google_api_key
      || configStore.getEffective('google_api_key')
      || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.warn('[nlIntent] Gemini not configured (GOOGLE_API_KEY missing) — falling back to heuristic');
      return { source: 'heuristic', result: heuristicResult, llm_attempted: false, llm_not_configured: true };
    }
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);
    try {
      const { callGemini } = require('./googleGeminiLlmService');
      const rawText = await callGemini([
        { role: 'system', content: systemWithCtx },
        { role: 'user', content: message },
      ], langchainConfig);
      const tryParse = (text) => {
        if (!text) return null;
        const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
        } catch (_) {}
        return null;
      };
      const parsed = tryParse(rawText);
      if (parsed) return logAndReturn({ source: 'google', result: parsed });
      llmAttempted = true;
    } catch (err) {
      console.warn('[nlIntent] Gemini intent error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // LM Studio JSON intent parsing — parallel to the Helix and Claude branches.
  // This is what lets the pure-LM-Studio mode (heuristicRouting:false) route
  // structured actions; without it, every message in that mode would only get a
  // conversational answer and action chips would break. Falls through to the
  // conversational answer below when the model returns kind:'none' or non-JSON.
  if (LMSTUDIO_PROVIDERS.has(selectedProvider)) {
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);
    try {
      const { callLmStudio } = require('./lmStudioLlmService');
      const raw = await callLmStudio([
        { role: 'system', content: systemWithCtx },
        { role: 'user', content: message },
      ]);
      const tryParse = (text) => {
        if (!text) return null;
        const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
        } catch (_) {}
        return null;
      };
      const parsed = tryParse(raw);
      if (parsed) return logAndReturn({ source: 'lmstudio', result: parsed });
      llmAttempted = true;
    } catch (err) {
      console.warn('[nlIntent] LM Studio intent error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // llama.cpp JSON intent parsing — same pattern as LM Studio above.
  // Lets "llama.cpp only" mode (heuristicRouting:false) route structured actions.
  if (LLAMACPP_PROVIDERS.has(selectedProvider)) {
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);
    try {
      const { callLlamaCpp } = require('./llamacppLlmService');
      const raw = await callLlamaCpp([
        { role: 'system', content: systemWithCtx },
        { role: 'user', content: message },
      ]);
      const tryParse = (text) => {
        if (!text) return null;
        const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
        } catch (_) {}
        return null;
      };
      const parsed = tryParse(raw);
      if (parsed) return logAndReturn({ source: 'llamacpp', result: parsed });
      llmAttempted = true;
    } catch (err) {
      console.warn('[nlIntent] llama.cpp intent error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // mlx-lm JSON intent parsing — same pattern as llama.cpp above.
  // Lets "MLX (Apple)" mode (heuristicRouting:false) route structured actions.
  if (MLX_PROVIDERS.has(selectedProvider)) {
    const systemWithCtx = buildSystemWithCtx(activeVertical, context);
    try {
      const { callMlx } = require('./mlxLlmService');
      const raw = await callMlx([
        { role: 'system', content: systemWithCtx },
        { role: 'user', content: message },
      ]);
      const tryParse = (text) => {
        if (!text) return null;
        const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.kind && parsed.kind !== 'none') return parsed;
        } catch (_) {}
        return null;
      };
      const parsed = tryParse(raw);
      if (parsed) return logAndReturn({ source: 'mlx', result: parsed });
      llmAttempted = true;
    } catch (err) {
      console.warn('[nlIntent] mlx-lm intent error:', err.message);
      return { source: 'heuristic', result: heuristicResult, llm_attempted: true };
    }
  }

  // In LLM-only mode go straight to the conversational answer
  // from whichever LLM the mode selected (Helix or LM Studio).
  if (!heuristicEnabled) {
    const llmAnswer = await answerConversational(message, context, selectedProvider, langchainConfig).catch((e) => {
      console.warn('[nlIntent] conversational LLM failed:', e.message);
      return null;
    });
    if (llmAnswer) {
      return logAndReturn({ source: conversationalSource(selectedProvider), result: llmAnswer });
    }
    // LLM-only mode but no LLM produced an answer (e.g. Helix not configured,
    // network failure). Fall back to the heuristic so chips and known phrases
    // still work — never let a UI canned "I didn't catch that" win.
    if (heuristicResult && heuristicResult.kind !== 'none') {
      console.warn('[nlIntent] LLM-only mode: no LLM produced an answer — falling back to heuristic');
      return { source: 'heuristic', result: heuristicResult, llm_attempted: llmAttempted };
    }
    return { source: 'heuristic', result: heuristicResult, llm_attempted: llmAttempted };
  }

  // 3. Try the selected LLM for general knowledge questions when banking intent
  // fails (fallback only) — Helix, LM Studio, llama.cpp, mlx-lm, or Claude.
  if (
    selectedProvider === 'helix' ||
    LMSTUDIO_PROVIDERS.has(selectedProvider) ||
    CLAUDE_PROVIDERS.has(selectedProvider) ||
    GOOGLE_PROVIDERS.has(selectedProvider) ||
    LLAMACPP_PROVIDERS.has(selectedProvider) ||
    MLX_PROVIDERS.has(selectedProvider) ||
    (selectedProvider === 'auto' && langchainConfig?.provider === 'helix')
  ) {
    const llmAnswer = await answerConversational(message, context, selectedProvider, langchainConfig).catch((e) => {
      console.warn('[nlIntent] conversational fallback failed:', e.message);
      return null;
    });
    if (llmAnswer) {
      return logAndReturn({ source: conversationalSource(selectedProvider), result: llmAnswer });
    }
  }

  // 4. Final fallback: return whatever heuristic gave (recognized result or kind:none).
  // The heuristic always ran at step 1; if it produced kind:none, this is the canonical
  // "no LLM available and heuristic didn't match" outcome — the UI shows its canned hint.
  return { source: 'heuristic', result: heuristicResult, llm_attempted: llmAttempted };
}

module.exports = {
  parseNaturalLanguage,
  EDU,
  __test: { buildSystem, buildSystemWithCtx, ensureRenderableAnswer },
};
