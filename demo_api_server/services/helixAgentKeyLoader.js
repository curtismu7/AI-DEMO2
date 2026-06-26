/**
 * Helix agent-key file loader.
 *
 * Helix's web console lets you download a per-agent API key as a JSON file
 * named <agentName>.json — keys: keyName, keyValue, expiration, scope, etc.
 * When the configured agent (configStore.helix_agent_id, default "LLM")
 * has no API key set via env / UI, we look for that JSON file in three
 * common locations and lift the keyValue out so the demo "just works".
 *
 * Search order (first match wins):
 *   1. Repo root            (where the user typically drops the export)
 *   2. ~/Documents/<file>.json
 *   3. ~/Downloads/<file>.json
 *
 * Successful lookups are memoized per agent name for the process lifetime.
 * Failed lookups (file absent or empty) are NOT cached, so dropping a key
 * file into the search path takes effect on the next request without a
 * server restart. To rotate a key, replace the file and restart.
 *
 * This loader is intentionally a fallback only — explicit HELIX_API_KEY
 * env var and configStore (set via /setup UI) both win.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();

// Map<string, { value: string, expiresAt: number|null }>
const cache = new Map();

function readAgentJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const value = typeof parsed.keyValue === 'string' ? parsed.keyValue.trim() : '';
    if (!value) return null;
    let expiresAt = null;
    if (parsed.expiration) {
      const t = new Date(parsed.expiration).getTime();
      if (!Number.isNaN(t)) {
        if (t < Date.now()) {
          // eslint-disable-next-line no-console
          console.warn(`[Helix] API key in ${filePath} expired at ${parsed.expiration} — ignoring`);
          return null;
        }
        expiresAt = t;
      }
    }
    return { value, expiresAt };
  } catch (_) {
    return null;
  }
}

/**
 * Load a Helix agent's API key from `<agentName>.json` in repo root,
 * ~/Documents, or ~/Downloads. Returns the keyValue string, or null if
 * no file is found / readable / contains a non-empty keyValue.
 *
 * @param {string} agentName  e.g. "LLM"
 * @returns {string|null}
 */
function loadAgentKey(agentName) {
  if (!agentName || typeof agentName !== 'string') return null;
  const safe = agentName.replace(/[^A-Za-z0-9_.-]/g, '');
  if (!safe) return null;

  if (cache.has(safe)) {
    const cached = cache.get(safe);
    if (cached.expiresAt === null || cached.expiresAt > Date.now()) {
      return cached.value;
    }
    // Cached key has since expired — evict and re-read from disk.
    cache.delete(safe);
    // eslint-disable-next-line no-console
    console.log(`[Helix] Cached API key for ${safe} expired — re-reading key file`);
  }

  const candidates = [
    path.join(REPO_ROOT, `${safe}.json`),
    path.join(REPO_ROOT, '.claude', 'skills', 'helix-setup', `${safe}.json`),
    path.join(HOME, 'Documents', `${safe}.json`),
    path.join(HOME, 'Downloads', `${safe}.json`),
  ];

  for (const filePath of candidates) {
    const result = readAgentJson(filePath);
    if (result) {
      cache.set(safe, result);
      try {
        // One-shot, non-secret log — keyValue itself never logged.
        // eslint-disable-next-line no-console
        console.log(`[Helix] API key loaded from ${filePath} (agent: ${safe})`);
      } catch (_) { /* swallow log errors */ }
      return result.value;
    }
  }

  // Don't cache misses — allows the file to appear without a server restart.
  return null;
}

/** Test/admin hook — clear the memoized lookup. */
function clearCache() {
  cache.clear();
}

module.exports = { loadAgentKey, clearCache };
