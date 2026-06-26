/**
 * Helix LLM Service
 *
 * Calls a published Helix agent via the conversation API:
 *   1. POST /environments/{env_id}/agents/{agent_name}/conversations
 *      Body must include { agent: { version: 'published' } } — required by Helix, omitting it returns null.
 *   2. POST /environments/{env_id}/conversations/{id}/channels/{home_channel}/messages
 *      Content-Type must be "application/json; async=false"
 *   3. Poll GET same messages URL; response is an array — find message whose id differs from posted message id.
 *
 * Auth: x-api-key header (NOT Authorization: Bearer).
 *
 * Hardening:
 *   - Per-request AbortController timeout on every fetch (FETCH_TIMEOUT_MS)
 *   - One transport retry with Connection:close on thrown errors
 *   - One retry with exponential backoff on 429 / 5xx
 *   - Exponential poll backoff (1s → 1.5s → 2s cap)
 *   - In-process circuit breaker: opens after CIRCUIT_FAILURE_THRESHOLD consecutive
 *     failures, rejects immediately for CIRCUIT_OPEN_MS, then half-opens to probe
 */

const fs = require('fs');
const configStore = require('./configStore');
const { callLmStudio } = require('./lmStudioLlmService');

const HELIX_PATH = '/dpc/jas/helix/v1';
const HELIX_LOG = process.env.HELIX_LOG_FILE || '/tmp/bank-helix.log';

// Per-fetch hard timeout (ms) — prevents a hanging Helix TCP connection from
// blocking the event loop indefinitely. Covers createConversation + sendMessage.
const FETCH_TIMEOUT_MS = 15000;

// Circuit breaker thresholds
const CIRCUIT_FAILURE_THRESHOLD = 5;   // consecutive failures before opening
const CIRCUIT_OPEN_MS = 30000;         // stay open for 30 s then probe

// Poll config
const POLL_DEADLINE_MS = 30000;
const POLL_BASE_MS = 1000;
const POLL_MAX_MS = 2000;
const POLL_BACKOFF = 1.5;

// --- Circuit breaker state (module-level, per-process) ---
let cbFailures = 0;
let cbOpenedAt = 0;  // 0 = closed

function cbIsOpen() {
  if (cbOpenedAt === 0) return false;
  if (Date.now() - cbOpenedAt > CIRCUIT_OPEN_MS) return false; // half-open: allow probe
  return true;
}

function cbRecordSuccess() {
  cbFailures = 0;
  cbOpenedAt = 0;
}

function cbRecordFailure() {
  cbFailures++;
  if (cbFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    if (cbOpenedAt === 0) {
      logHelix('warn', `Circuit breaker OPEN after ${cbFailures} consecutive failures — fast-failing for ${CIRCUIT_OPEN_MS}ms`);
    }
    cbOpenedAt = Date.now();
  }
}

// --- Logging ---
let _appEvents;
function logHelix(severity, message, metadata) {
  const ts = new Date().toISOString();
  const meta = metadata ? ' ' + JSON.stringify(metadata) : '';
  const line = `${ts} [helix/${severity}] ${message}${meta}\n`;
  try { fs.appendFileSync(HELIX_LOG, line); } catch (writeErr) { console.warn('[helixLlmService] log write failed:', writeErr.message); }
  if (!_appEvents) {
    try { _appEvents = require('./appEventService'); } catch (_) { return; }
  }
  _appEvents.logEvent('helix', severity, message, { tag: 'helix/llm', metadata: metadata });
}

// Always use just the origin — strip any console/UI path the user may have copied.
function apiBase(baseUrl) {
  try {
    return new URL(baseUrl).origin + HELIX_PATH;
  } catch {
    return baseUrl.replace(/\/$/, '').replace(/\/dpc\/.*$/, '') + HELIX_PATH;
  }
}

/**
 * fetch with a hard AbortController timeout and one transport-level retry.
 *
 * Transport errors (TypeError thrown by undici on socket reset / DNS blip) are
 * retried once with Connection:close to avoid reusing a poisoned keep-alive socket.
 * HTTP error statuses are returned to the caller — not retried here.
 */
async function helixFetch(url, options, label) {
  async function attempt(extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        headers: { ...(options?.headers || {}), ...extraHeaders },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Helix ${label} timed out after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    return await attempt();
  } catch (err) {
    const cause = err?.cause;
    logHelix('warn', `${label} transport error — retrying once with a fresh connection`, {
      message: err?.message,
      cause: cause?.code || cause?.message || (cause ? String(cause) : undefined),
    });
    await new Promise((r) => setTimeout(r, 250));
    return await attempt({ Connection: 'close' });
  }
}

/**
 * helixFetch + one retry on 429 / 5xx with exponential backoff.
 */
async function helixFetchWithRetry(url, options, label) {
  const res = await helixFetch(url, options, label);
  if (res.ok || (res.status < 429 && res.status !== 429)) return res;

  // Retryable: 429 rate-limit or 5xx transient error
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = res.headers?.get?.('Retry-After');
    const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2_000;
    logHelix('warn', `${label} got ${res.status} — retrying in ${backoffMs}ms`, { status: res.status });
    await new Promise((r) => setTimeout(r, backoffMs));
    return await helixFetch(url, options, `${label}/retry`);
  }

  return res;
}

/**
 * Extract text value from a Helix response message.
 * Messages can be a plain object or an array; look for class:"complete" or just grab .value.
 */
function extractValue(data) {
  const items = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : [data]);
  const done = items.find((m) => m && (m.class === 'complete' || m.message_class === 'complete') && m.value != null);
  const raw = done?.value ?? null;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.response === 'string') return parsed.response;
  } catch { /* not JSON — use raw */ }
  return raw;
}

function contentPreview(text, max = 300) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

var QUOTA_REPLY_RE = /\b(?:token\ )?quota\ (?:exceeded|exhausted)\b|\bout\ of\ (?:tokens|quota|credits?)\b|\binsufficient\ (?:tokens|quota|credits?)\b/i;

function isQuotaReply(text) {
  return typeof text === 'string' && QUOTA_REPLY_RE.test(text);
}

function lmStudioFallbackEnabled() {
  const v = configStore.getEffective('ff_helix_lmstudio_fallback');
  return v === true || v === 'true';
}

async function maybeFailoverToLmStudio(content, messages, conversationId) {
  if (!isQuotaReply(content) || !lmStudioFallbackEnabled()) return content;
  logHelix('warn', 'quota exhausted — failing over to LM Studio', {
    conversationId, preview: contentPreview(content),
  });
  try {
    const reply = await callLmStudio(messages);
    logHelix('info', 'LM Studio failover reply received', {
      conversationId, preview: contentPreview(reply),
    });
    return reply;
  } catch (err) {
    logHelix('error', `LM Studio failover failed: ${err.message}`, { conversationId });
    return content;
  }
}

/**
 * @param {object} config
 * @param {string} config.helix_base_url
 * @param {string} config.helix_api_key
 * @param {string} config.helix_environment_id
 * @param {string} config.helix_agent_id
 * @param {string} config.helix_prompt_field_id
 * @param {Array}  messages  - [{role:'user'|'system'|'assistant', content:'...'}]
 * @returns {Promise<string>}
 */
async function callHelixAgent(config, messages) {
  const { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id } = config;

  const missing = [];
  if (!helix_base_url) missing.push('helix_base_url');
  if (!helix_api_key) missing.push('helix_api_key');
  if (!helix_environment_id) missing.push('helix_environment_id');
  if (!helix_agent_id) missing.push('helix_agent_id');
  if (!helix_prompt_field_id) missing.push('helix_prompt_field_id');
  if (missing.length) throw new Error(`Helix config incomplete: missing ${missing.join(', ')}`);
  if (!messages || messages.length === 0) throw new Error('No messages provided to Helix agent');

  // Circuit breaker — fast-fail if Helix is known-down
  if (cbIsOpen()) {
    const remainingMs = CIRCUIT_OPEN_MS - (Date.now() - cbOpenedAt);
    throw new Error(`Helix circuit breaker OPEN — skipping call (resets in ~${Math.ceil(remainingMs / 1000)}s)`);
  }

  const base = apiBase(helix_base_url);
  const apiKey = helix_api_key;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user' || m.role === 'human')
    || messages[messages.length - 1];
  const userText = typeof lastUser.content === 'string' ? lastUser.content : String(lastUser.content ?? '');

  const systemMsg = messages.find((m) => m.role === 'system');
  const systemText = systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : String(systemMsg.content ?? '')) : '';
  const prompt = systemText ? `${systemText}\n\n${userText}` : userText;

  logHelix('info', 'Helix call started', { agent: helix_agent_id, environment: helix_environment_id });

  try {
    // Step 1 — create conversation
    const convRes = await helixFetchWithRetry(
      `${base}/environments/${helix_environment_id}/agents/${helix_agent_id}/conversations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ agent: { version: 'published' } }),
      },
      'createConversation',
    );
    if (!convRes.ok) {
      const errText = await convRes.text();
      logHelix('error', `createConversation failed: ${convRes.status}`, { status: convRes.status, body: errText });
      throw new Error(`Helix createConversation failed: ${convRes.status} ${errText}`);
    }
    const conv = await convRes.json();
    if (!conv || !conv.id) {
      logHelix('error', 'createConversation returned null — check agent name, key scope, and published version', { agent: helix_agent_id });
      throw new Error(`Helix createConversation returned null — check agent name, key scope, and agent version`);
    }
    const { id: conversationId, home_channel: channelId } = conv;
    logHelix('info', 'Conversation created', { conversationId, channelId });

    // Step 2 — post message
    const msgRes = await helixFetchWithRetry(
      `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; async=false', 'x-api-key': apiKey },
        body: JSON.stringify({ class: 'start', content: { [helix_prompt_field_id]: prompt } }),
      },
      'sendMessage',
    );
    if (!msgRes.ok) {
      const errText = await msgRes.text();
      logHelix('error', `sendMessage failed: ${msgRes.status}`, { status: msgRes.status, body: errText });
      throw new Error(`Helix sendMessage failed: ${msgRes.status} ${errText}`);
    }
    const msgData = await msgRes.json();
    const queryMessageId = msgData?.message_id || msgData?.id;

    // Check if POST response already contains the answer
    const immediate = extractValue(msgData);
    if (immediate != null) {
      logHelix('info', 'Response received (immediate)', { conversationId, preview: contentPreview(immediate) });
      cbRecordSuccess();
      return await maybeFailoverToLmStudio(immediate, messages, conversationId);
    }
    logHelix('info', 'Polling for response', { conversationId });

    // Step 3 — poll with exponential backoff
    const pollUrl = `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`;
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let pollInterval = POLL_BASE_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * POLL_BACKOFF, POLL_MAX_MS);

      const pollRes = await helixFetch(pollUrl, { headers: { 'x-api-key': apiKey } }, 'poll');
      if (!pollRes.ok) {
        const errText = await pollRes.text();
        logHelix('error', `poll failed: ${pollRes.status}`, { status: pollRes.status, body: errText });
        throw new Error(`Helix poll failed: ${pollRes.status} ${errText}`);
      }
      const data = await pollRes.json();

      const messages_ = Array.isArray(data) ? data : [];
      const agentMsg = messages_.find((m) =>
        m.sender_role === 'agent' &&
        m.message_id !== queryMessageId &&
        m.value != null
      );
      if (agentMsg) {
        const result = extractValue(agentMsg);
        if (result != null) {
          logHelix('info', 'Response received (poll)', { conversationId, preview: contentPreview(result) });
          cbRecordSuccess();
          return await maybeFailoverToLmStudio(result, messages, conversationId);
        }
      }

      const result = extractValue(data);
      if (result != null) {
        logHelix('info', 'Response received (poll/top-level)', { conversationId, preview: contentPreview(result) });
        cbRecordSuccess();
        return await maybeFailoverToLmStudio(result, messages, conversationId);
      }
    }

    logHelix('error', 'Timed out waiting for Helix response', { conversationId, agent: helix_agent_id });
    throw new Error('Timed out waiting for Helix response');

  } catch (err) {
    // Don't count circuit-breaker fast-fails as new failures
    if (!err.message.includes('circuit breaker OPEN')) {
      cbRecordFailure();
    }
    throw err;
  }
}

module.exports = { callHelixAgent };
