'use strict';

/**
 * Ring buffer of OAuth verbose lines for admin viewing without the host dashboard.
 *
 * - File-based: append to data/logs/oauth-verbose.log (trimmed if oversized)
 * - Fallback: in-memory only (lost on restart)
 */

const fs = require('fs');
const path = require('path');

const MAX_LINES = 500;
const MAX_FILE_BYTES = 512 * 1024;

const memoryLines = [];

function _logDir() {
  return path.join(__dirname, '..', 'data', 'logs');
}

function _logFile() {
  return path.join(_logDir(), 'oauth-verbose.log');
}

function _ensureDir() {
  const dir = _logDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Append one line (already includes timestamp if desired). Sync + fire-and-forget KV.
 * @param {string} line - The log line to append
 * @param {string} [userId] - Optional user ID to segregate logs by user
 */
function appendLine(line, userId) {
  const text = String(line).replace(/\r?\n/g, ' ');
  const prefixedText = userId ? `[${userId}] ${text}` : text;
  memoryLines.push(prefixedText);
  while (memoryLines.length > MAX_LINES) memoryLines.shift();

  if (!process.env.REPL_ID) {
    try {
      _ensureDir();
      const fp = _logFile();
      fs.appendFileSync(fp, prefixedText + '\n', 'utf8');
      const st = fs.statSync(fp);
      if (st.size > MAX_FILE_BYTES) {
        const raw = fs.readFileSync(fp, 'utf8');
        const half = raw.slice(Math.floor(raw.length / 2));
        fs.writeFileSync(fp, half.trimStart() + '\n', 'utf8');
      }
    } catch (e) {
      console.error('[oauthVerboseLogStore] file append failed:', e.message);
    }
  }
}

/**
 * Return recent lines (oldest first for reading top-to-bottom).
 * @param {string} [userId] - Optional user ID to filter logs by user
 * @param {number} [limit] - Maximum number of lines to return (default 200)
 */
async function getRecentLines(userId, limit = 200) {
  // Handle overloaded signature: getRecentLines() or getRecentLines(limit) or getRecentLines(userId, limit)
  if (typeof userId === 'number') {
    limit = userId;
    userId = undefined;
  }

  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_LINES);

  try {
    const fp = _logFile();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8');
      let all = raw.split('\n').filter(Boolean);
      if (userId) {
        all = all.filter(line => line.startsWith(`[${userId}]`));
      }
      return { lines: all.slice(-n), backend: 'file' };
    }
  } catch (e) {
    console.error('[oauthVerboseLogStore] file read failed:', e.message);
  }

  let lines = memoryLines.slice(-n);
  if (userId) {
    lines = lines.filter(line => line.startsWith(`[${userId}]`));
  }
  return { lines, backend: 'memory' };
}

async function clear() {
  memoryLines.length = 0;

  try {
    const fp = _logFile();
    if (fs.existsSync(fp)) fs.writeFileSync(fp, '', 'utf8');
  } catch (e) {
    console.error('[oauthVerboseLogStore] file clear failed:', e.message);
  }
}

function clearAllLogs() {
  memoryLines.length = 0;
  try {
    const fp = _logFile();
    if (fs.existsSync(fp)) fs.writeFileSync(fp, '', 'utf8');
  } catch (e) {
    console.error('[oauthVerboseLogStore] file clear failed:', e.message);
  }
}

module.exports = { appendLine, getRecentLines, clear, clearAllLogs, MAX_LINES };
