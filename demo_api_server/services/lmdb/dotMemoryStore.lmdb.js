'use strict';
/**
 * dotMemoryStore.lmdb.js — LMDB-backed "dot" working memory (per user).
 *
 * Mirrors OpenAI's dots: an always-on personal agent keeps its OWN persistent
 * memory — preferences, standards, context — separate from conversation
 * history. The enterprise never governs this memory; it governs the dot's
 * tool calls. "Reset the dot" clears it all.
 *
 *   - Key: `dotmem:${userId}:${timestamp_15digit_padded}:${seq}`
 *   - Value: { text, timestamp }
 *   - Cap: MAX_MEMORIES_PER_USER newest kept, oldest evicted on write.
 */

const { getDb } = require('./openEnv');

const DB_NAME = 'dot_memory';
const MAX_MEMORIES_PER_USER = 50;
const MAX_MEMORY_LENGTH = 500;

function _db() {
  return getDb(DB_NAME);
}

function _padTimestamp(timestamp) {
  return String(timestamp).padStart(15, '0');
}

// Preference-shaped sentences: "Always…", "Never…", "Prefer…", "From now on…",
// "Call me…", "I like…". Anchored at sentence start to avoid mid-sentence false
// positives ("I always wanted to see Denver" is a request, not a standing rule).
const PREFERENCE_RE = /^(?:always|never|prefer|from now on|call me|i like|i want you to)\b.*/i;

function extractMemories(prompt) {
  // Sentence-first, then prefix-match: a global regex over the whole prompt
  // lets one match consume the punctuation the next sentence needs as its
  // boundary ("…Skip. Never book…" matched only the first).
  return String(prompt || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length >= 8 && s.length <= MAX_MEMORY_LENGTH && PREFERENCE_RE.test(s));
}

function createDotMemoryStore({ db = _db(), now = () => Date.now(), maxMemories = MAX_MEMORIES_PER_USER } = {}) {
  function saveMemory(userId, text) {
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!userId || clean.length < 8 || clean.length > MAX_MEMORY_LENGTH) return false;
    const prefix = `dotmem:${userId}:`;
    // Evict oldest beyond the cap BEFORE the write, so the prefix range stays bounded.
    const existing = _range(db, prefix);
    if (existing.length >= maxMemories) {
      for (const { key } of existing.slice(0, existing.length - maxMemories + 1)) db.removeSync(key);
    }
    // Seq suffix lets several memories land in the same millisecond (one prompt
    // can carry multiple preference sentences) — same pattern as conversationStore.
    const ts = _padTimestamp(now());
    const keyPrefix = `${prefix}${ts}:`;
    let seq = 0;
    for (const { key } of db.getRange({ start: keyPrefix, end: `${keyPrefix}￿` })) {
      const keySeq = parseInt(key.split(':').pop() || '0', 10);
      if (keySeq >= seq) seq = keySeq + 1;
    }
    db.putSync(`${keyPrefix}${seq}`, { text: clean, timestamp: now() });
    return true;
  }

  function getMemories(userId) {
    if (!userId) return [];
    // Reverse-range: newest first. getRange returns an iterable, not an array.
    return Array.from(_range(db, `dotmem:${userId}:`)).reverse().map(({ value }) => value);
  }

  function clearMemories(userId) {
    if (!userId) return;
    for (const { key } of _range(db, `dotmem:${userId}:`)) db.removeSync(key);
  }

  return { saveMemory, getMemories, clearMemories };
}

function _range(db, prefix) {
  const start = prefix;
  const end = `${prefix}￿`;
  return db.getRange({ start, end });
}

module.exports = { createDotMemoryStore, extractMemories, MAX_MEMORIES_PER_USER, MAX_MEMORY_LENGTH };
