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
 */

const fs = require('fs');
const configStore = require('./configStore');
const { callLmStudio } = require('./lmStudioLlmService');

const HELIX_PATH = '/dpc/jas/helix/v1';
const HELIX_LOG = process.env.HELIX_LOG_FILE || '/tmp/bank-helix.log';

let _appEvents;
function logHelix(severity, message, metadata) {
  const ts = new Date().toISOString();
  const meta = metadata ? ' ' + JSON.stringify(metadata) : '';
  const line = `${ts} [helix/${severity}] ${message}${meta}\n`;

  // Write to dedicated log file for tail -f
  try { fs.appendFileSync(HELIX_LOG, line); } catch (writeErr) { console.warn('[helixLlmService] log write failed:', writeErr.message); }

  // Publish to structured event ring buffer
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

// undici `fetch` throws a TypeError ("fetch failed") on TRANSPORT failures
// (socket reset, DNS blip, a stale pooled keep-alive connection) — distinct from
// an HTTP error status, which returns a response. A long-lived process (the BFF)
// intermittently hits these where a freshly-started process never does, so retry
// once on a thrown error with a fresh connection (`Connection: close` avoids
// reusing a poisoned keep-alive socket). HTTP error statuses are NOT retried here
// — callers inspect `res.ok`. Mirrors the gateway introspection transport-retry.
async function helixFetch(url, options, label) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const cause = err?.cause;
    logHelix('warn', `${label} transport error — retrying once with a fresh connection`, {
      message: err?.message,
      cause: cause?.code || cause?.message || (cause ? String(cause) : undefined),
    });
    await new Promise((r) => setTimeout(r, 250));
    const retryOpts = { ...options, headers: { ...(options?.headers || {}), Connection: 'close' } };
    return await fetch(url, retryOpts);
  }
}

/**
 * Extract text value from a Helix response message.
 * Messages can be a plain object or an array; look for class:"complete" or just grab .value.
 */
function extractValue(data) {
  // Array of messages — find the agent's completed message
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

/**
 * Single-line, truncated preview of returned content for logs. Helix relays the
 * upstream model's reply (including quota / error text like "Token quota exceeded")
 * as ordinary HTTP-200 content, so logging the conversationId alone hides it — this
 * captures the verbatim text (truncated) so such cases are visible in the log.
 */
function contentPreview(text, max = 300) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// Helix relays the upstream model's quota error as ordinary HTTP-200 content
// (e.g. "Token quota exceeded"), so it can only be detected in the reply text.
const QUOTA_REPLY_RE = /\b(?:token )?quota (?:exceeded|exhausted)\b|\bout of (?:tokens|quota|credits?)\b|\binsufficient (?:tokens|quota|credits?)\b/i;

function isQuotaReply(text) {
  return typeof text === 'string' && QUOTA_REPLY_RE.test(text);
}

function lmStudioFallbackEnabled() {
  const v = configStore.getEffective('ff_helix_lmstudio_fallback');
  return v === true || v === 'true';
}

/**
 * If the Helix reply is a quota-exhausted message and the fallback flag is on,
 * transparently re-run the turn on the local LM Studio model and return its reply
 * instead. On any LM Studio failure, fall back to the original Helix message so the
 * caller always gets a response.
 */
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
    return content; // LM Studio unreachable — return Helix's original message
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

  const base = apiBase(helix_base_url);
  const apiKey = helix_api_key;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user' || m.role === 'human')
    || messages[messages.length - 1];
  const userText = typeof lastUser.content === 'string' ? lastUser.content : String(lastUser.content ?? '');

  // Helix directive field is not always active in published agents.
  // Prepend any system message so the LLM receives the full instruction context.
  const systemMsg = messages.find((m) => m.role === 'system');
  const systemText = systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : String(systemMsg.content ?? '')) : '';
  const prompt = systemText ? `${systemText}\n\n${userText}` : userText;

  logHelix('info', 'Helix call started', { agent: helix_agent_id, environment: helix_environment_id });

  // Step 1 — create conversation
  // IMPORTANT: body must include agent.version or Helix returns null
  const convRes = await helixFetch(
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
  logHelix('info', 'Conversation created', { conversationId: conversationId, channelId: channelId });

  // Step 2 — post message
  // Content-Type must include async=false per Helix API spec
  const msgRes = await helixFetch(
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
    logHelix('info', 'Response received (immediate)', { conversationId: conversationId, preview: contentPreview(immediate) });
    return await maybeFailoverToLmStudio(immediate, messages, conversationId);
  }
  logHelix('info', 'Polling for response', { conversationId: conversationId });

  // Step 3 — poll for agent response
  const pollUrl = `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`;
  const deadline = Date.now() + 30_000;
  const interval = 1_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const pollRes = await helixFetch(pollUrl, { headers: { 'x-api-key': apiKey } }, 'poll');
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      logHelix('error', `poll failed: ${pollRes.status}`, { status: pollRes.status, body: errText });
      throw new Error(`Helix poll failed: ${pollRes.status} ${errText}`);
    }
    const data = await pollRes.json();

    // Filter out the message we posted — look for the agent's reply
    // Poll response uses message_id (not id); agent messages have sender_role:"agent"
    const messages_ = Array.isArray(data) ? data : [];
    const agentMsg = messages_.find((m) =>
      m.sender_role === 'agent' &&
      m.message_id !== queryMessageId &&
      m.value != null
    );
    if (agentMsg) {
      const result = extractValue(agentMsg);
      if (result != null) {
        logHelix('info', 'Response received (poll)', { conversationId: conversationId, preview: contentPreview(result) });
        return await maybeFailoverToLmStudio(result, messages, conversationId);
      }
    }

    // Also check top-level if response isn't an array
    const result = extractValue(data);
    if (result != null) {
      logHelix('info', 'Response received (poll/top-level)', { conversationId: conversationId, preview: contentPreview(result) });
      return await maybeFailoverToLmStudio(result, messages, conversationId);
    }
  }

  logHelix('error', 'Timed out waiting for Helix response', { conversationId: conversationId, agent: helix_agent_id });
  throw new Error('Timed out waiting for Helix response');
}

module.exports = { callHelixAgent };
