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
 */
function appendLine(line) {
  const text = String(line).replace(/\r?\n/g, ' ');
  memoryLines.push(text);
  while (memoryLines.length > MAX_LINES) memoryLines.shift();

  if (!process.env.REPL_ID) {
    try {
      _ensureDir();
      const fp = _logFile();
      fs.appendFileSync(fp, text + '\n', 'utf8');
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
 */
async function getRecentLines(limit = 200) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_LINES);

  try {
    const fp = _logFile();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8');
      const all = raw.split('\n').filter(Boolean);
      return { lines: all.slice(-n), backend: 'file' };
    }
  } catch (e) {
    console.error('[oauthVerboseLogStore] file read failed:', e.message);
  }

  return { lines: memoryLines.slice(-n), backend: 'memory' };
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

module.exports = { appendLine, getRecentLines, clear, MAX_LINES };
