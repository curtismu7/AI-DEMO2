'use strict';
/**
 * conversationStore.lmdb.js — LMDB-backed conversation history persistence.
 *
 * Stores multi-turn conversation messages per user+vertical thread:
 *   - Key: `${userId}:${vertical}:${timestamp_15digit_padded}:${seq}`
 *   - Value: { role, content, timestamp, runId, intent, agentPath }
 *
 * Thread model: one thread per userId:vertical combination. Conversations are
 * independent per vertical (banking, wealth, admin, etc.).
 *
 * Write: messages are appended with auto-pruning when thread exceeds 500 messages.
 * Read: reverse-range prefix scan retrieves the last N messages in chronological order.
 */

const { getDb } = require('./openEnv');
const crypto = require('crypto');

const DB_NAME = 'conversations';
const SUMMARIES_TABLE = 'conversation_summaries';
const MAX_MESSAGES_PER_THREAD = 500;
const DEFAULT_HISTORY_LIMIT = 30;

// Regex patterns for extraction-based summaries (Phase 1)
const ACCOUNT_PATTERN = /account\s*(?:number|no|#|id)?[\s:]*([A-Za-z0-9]{10,20})/gi;
const AMOUNT_PATTERN = /(?:amount|transfer|pay)[\s:]*\$?([\d,]+(?:\.\d{2})?)/gi;
const ACTION_KEYWORDS = /(?:transfer|send|pay|deposit|withdraw|check|balance|open|close|apply|approve|deny)/gi;

function _db() {
  return getDb(DB_NAME);
}

/**
 * True for real conversation messages, false for summary entries (or any other
 * non-message value). Summaries live under `${prefix}_summary:${id}` keys and
 * `_` (0x5F) sorts AFTER the digits that lead every message key, so a bare
 * `[prefix, prefix+￿]` range scan pulls them in. Summary objects carry no
 * `role`/`content` (they have `summary`/`method`/`createdAt` instead), so a
 * value-shape guard excludes them regardless of key ordering and without
 * depending on any stored-key format. The dedicated summary reader
 * (`getSummaries`) uses the `_summary:` sub-prefix and is unaffected.
 * @private
 */
function _isMessage(value) {
  return !!value && typeof value === 'object'
    && typeof value.role === 'string'
    && typeof value.content === 'string';
}

/**
 * Generate a unique summary ID.
 * @returns {string} - e.g., "sum_a1b2c3d4"
 */
function _generateSummaryId() {
  return 'sum_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Extract key entities and actions from conversation text (extraction-based summary).
 * Phase 1: simple regex + keyword extraction (no LLM).
 * @param {array} messages - conversation messages
 * @returns {object} - { accountNumbers, actions, keyTopics, summary }
 */
function _extractSummary(messages) {
  const accountNumbers = new Set();
  const amounts = new Set();
  const actions = new Set();
  const fullText = messages.map((m) => m.content || '').join('\n');

  // Extract account numbers
  let match;
  while ((match = ACCOUNT_PATTERN.exec(fullText)) !== null) {
    accountNumbers.add(match[1]);
  }

  // Extract amounts
  while ((match = AMOUNT_PATTERN.exec(fullText)) !== null) {
    amounts.add(match[1]);
  }

  // Extract action keywords
  while ((match = ACTION_KEYWORDS.exec(fullText)) !== null) {
    actions.add(match[0].toLowerCase());
  }

  // Build a human-readable summary snippet from the last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const summaryText = lastAssistant ? lastAssistant.content.substring(0, 200) : 'User requested banking assistance.';

  return {
    accountNumbers: Array.from(accountNumbers).slice(0, 5), // Top 5
    amounts: Array.from(amounts).slice(0, 3),
    actions: Array.from(actions),
    summary: summaryText,
  };
}

/**
 * Generate a zero-padded 15-digit timestamp for lexicographic ordering.
 * Ensures: lexicographic order = chronological order.
 * @param {number} timestamp - milliseconds since epoch (Date.now())
 * @returns {string} - zero-padded timestamp, e.g., "000001751234567890"
 */
function _padTimestamp(timestamp) {
  return String(timestamp).padStart(15, '0');
}

/**
 * Save a message to the conversation thread.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context (e.g., 'banking', 'wealth', 'admin')
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - message text
 * @param {object} metadata - optional { runId, intent, agentPath, ... }
 */
function saveMessage(userId, vertical, role, content, metadata = {}) {
  if (!userId || !vertical) {
    throw new Error('userId and vertical are required');
  }

  const db = _db();
  const now = Date.now();
  const timestampPadded = _padTimestamp(now);
  const prefix = `${userId}:${vertical}:`;

  // Find the next sequence number for this timestamp
  // (allow multiple messages in the same millisecond)
  let seq = 0;
  const keyPrefix = `${prefix}${timestampPadded}:`;
  for (const { key } of db.getRange({
    start: keyPrefix,
    end: `${keyPrefix}￿`,
  })) {
    const parts = key.split(':');
    const keySeq = parseInt(parts[4] || '0', 10);
    if (keySeq >= seq) seq = keySeq + 1;
  }

  const key = `${prefix}${timestampPadded}:${seq}`;
  const value = {
    role,
    content,
    timestamp: now,
    ...metadata,
  };

  db.putSync(key, value);

  // Prune if thread exceeds MAX_MESSAGES_PER_THREAD
  _pruneThreadIfNeeded(userId, vertical, prefix);
}

/**
 * Prune the oldest messages from a thread if it exceeds MAX_MESSAGES_PER_THREAD.
 * @private
 */
function _pruneThreadIfNeeded(userId, vertical, prefix) {
  const db = _db();
  const messages = [];

  for (const { key, value } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    // Never prune summaries — they lack `.timestamp`, so a bare `value.timestamp||0`
    // sorted them to 0 and deleted them first. Only real messages count/prune.
    if (!_isMessage(value)) continue;
    messages.push({ key, timestamp: value.timestamp || 0 });
  }

  if (messages.length > MAX_MESSAGES_PER_THREAD) {
    // Sort by timestamp and delete the oldest
    const toDelete = messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, messages.length - MAX_MESSAGES_PER_THREAD);

    for (const { key } of toDelete) {
      db.removeSync(key);
    }
  }
}

/**
 * Retrieve the last N messages from a conversation thread in chronological order.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @param {number} limit - max messages to return (default: 30)
 * @returns {array} - array of { role, content, timestamp, ... }, oldest first
 */
function getHistory(userId, vertical, limit = DEFAULT_HISTORY_LIMIT) {
  if (!userId || !vertical) {
    return [];
  }

  const db = _db();
  const prefix = `${userId}:${vertical}:`;
  const messages = [];

  // Reverse-range scan to get the newest messages first. Summaries sort AFTER
  // all message keys (leading `_` > digits), so in reverse they appear first —
  // a DB-level `limit` would let them evict real messages from the window and
  // could surface a summary as the newest "message". Skip non-messages and stop
  // once we have `limit` real messages instead.
  for (const { key, value } of db.getRange({
    start: `${prefix}￿`,
    end: prefix,
    reverse: true,
  })) {
    if (!_isMessage(value)) continue;
    messages.push(value);
    if (messages.length >= limit) break;
  }

  // Reverse back to chronological order (oldest first)
  return messages.reverse();
}

/**
 * Clear all messages for a thread (for testing/reset).
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 */
function clearHistory(userId, vertical) {
  if (!userId || !vertical) return;

  const db = _db();
  const prefix = `${userId}:${vertical}:`;

  for (const { key } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    db.removeSync(key);
  }
}

/**
 * Get the full thread size (for diagnostics).
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @returns {number} - count of messages in thread
 */
function getThreadSize(userId, vertical) {
  if (!userId || !vertical) return 0;

  const db = _db();
  const prefix = `${userId}:${vertical}:`;
  let count = 0;

  for (const { value } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    if (_isMessage(value)) count++; // exclude summary entries from the thread size
  }

  return count;
}

/**
 * Save a summary of a conversation range to the summaries table.
 * Phase 2: supports both extraction-based (default) and LLM-based summaries.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @param {array} messages - messages to summarize
 * @param {number} sourceStartIdx - start index in thread
 * @param {number} sourceEndIdx - end index in thread
 * @param {string} llmSummary - optional LLM-generated summary (Phase 2)
 * @returns {object} - { summaryId, summary, metadata }
 */
function saveSummary(userId, vertical, messages, sourceStartIdx, sourceEndIdx, llmSummary) {
  const db = _db();
  const summaryId = _generateSummaryId();
  const extracted = _extractSummary(messages);
  const originalLength = messages.reduce((sum, m) => sum + (m.content || '').length, 0);

  // Phase 2: use LLM summary if provided, else extraction-based
  const summary = llmSummary || extracted.summary;
  const method = llmSummary ? 'llm' : 'extraction';
  const summaryLength = summary.length;
  const lossRatio = originalLength > 0 ? summaryLength / originalLength : 0;

  const summaryObj = {
    id: summaryId,
    createdAt: Date.now(),
    userId,
    vertical,
    sourceStartIdx,
    sourceEndIdx,
    originalMessages: messages.length,
    originalLength,
    summaryLength,
    summary,
    keyEntities: {
      accountNumbers: extracted.accountNumbers,
      amounts: extracted.amounts,
      actions: extracted.actions,
    },
    lossRatio: Math.round(lossRatio * 100) / 100,
    method,
  };

  const key = `${userId}:${vertical}:_summary:${summaryId}`;
  db.putSync(key, summaryObj);

  return { summaryId, summary, metadata: summaryObj };
}

/**
 * Get all summaries for a thread.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @returns {array} - summaries for this thread
 */
function getSummaries(userId, vertical) {
  const db = _db();
  const prefix = `${userId}:${vertical}:_summary:`;
  const summaries = [];

  for (const { key, value } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    if (value) summaries.push(value);
  }

  return summaries;
}

/**
 * Check if summarization is needed (Phase 2: auto-triggers).
 * Implements two triggers:
 *   1. Token budget: summarize when thread reaches 70% of context window
 *   2. Turn count: summarize every 20 turns (or custom via env)
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @returns {object|null} - { trigger, startIdx, endIdx } or null if no trigger
 */
function isSummarizationNeeded(userId, vertical) {
  if (process.env.AUTO_SUMMARIZE !== 'true') {
    return null;
  }

  const db = _db();
  const prefix = `${userId}:${vertical}:`;
  const messages = [];

  // Collect all messages for this thread (summary entries excluded — they are
  // not turns and must not inflate the turn-count / token-budget triggers).
  for (const { key, value } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    if (_isMessage(value)) messages.push(value);
  }

  if (messages.length === 0) return null;

  // Trigger 1: Turn count (every 20 turns by default)
  const turnThreshold = parseInt(process.env.SUMMARIZE_TURN_THRESHOLD || '20', 10);
  if (messages.length % turnThreshold === 0 && messages.length > turnThreshold) {
    // Summarize the first 50% of messages
    const cutoff = Math.floor(messages.length * 0.5);
    return {
      trigger: 'turn_count',
      startIdx: 0,
      endIdx: cutoff,
    };
  }

  // Trigger 2: Token budget (70% of estimated context window)
  // Rough estimate: 1 token ≈ 4 chars (OpenAI heuristic)
  const totalChars = messages.reduce((sum, m) => sum + (m.content || '').length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  const contextWindow = 200000; // Anthropic/LM Studio typical
  const tokenThreshold = parseInt(process.env.SUMMARIZE_TOKEN_THRESHOLD || Math.floor(contextWindow * 0.7).toString(), 10);

  if (estimatedTokens >= tokenThreshold && messages.length > 10) {
    // Summarize messages up to 50% mark
    const cutoff = Math.floor(messages.length * 0.5);
    return {
      trigger: 'token_budget',
      startIdx: 0,
      endIdx: cutoff,
      tokens: estimatedTokens,
      threshold: tokenThreshold,
    };
  }

  return null;
}

/**
 * Mark messages as included in a summary (adds metadata to original messages).
 * Phase 1: placeholder (actual marking deferred to Phase 2).
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @param {number} startIdx - start index
 * @param {number} endIdx - end index
 * @param {string} summaryId - summary ID
 */
function markMessagesInSummary(userId, vertical, startIdx, endIdx, summaryId) {
  // Phase 1: no-op. Phase 2 will update message metadata with _summary field.
}

module.exports = {
  saveMessage,
  getHistory,
  clearHistory,
  getThreadSize,
  saveSummary,
  getSummaries,
  isSummarizationNeeded,
  markMessagesInSummary,
  DEFAULT_HISTORY_LIMIT,
  MAX_MESSAGES_PER_THREAD,
};