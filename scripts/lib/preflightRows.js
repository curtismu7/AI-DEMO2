'use strict';

/*
 * Pure decision logic for the MCP door preflight (scripts/check-mcp-preflight.js).
 * Split out so it can be tested without a network.
 *
 * The load-bearing judgement is what a 401 means. The Privilege AI Gateway
 * answers 401 BEFORE it routes, so a nonexistent app name returns 401 exactly
 * like a real one. An unauthenticated probe can therefore prove DNS, TLS and
 * reachability, and nothing about authorization. `auth` is its own state for
 * that reason: it passes the gate, and it never claims the door actually works
 * for a real caller.
 */

const PASSING = new Set(['ok', 'auth']);

/** @returns {{state: 'ok'|'auth'|'down'|'unreachable', note: string}} */
function classifyProbe({ status, error } = {}) {
  // An Error, not a string, is what a rejected fetch actually carries.
  if (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { state: 'unreachable', note: text.slice(0, 160) };
  }
  if (status === 200) return { state: 'ok', note: '' };
  if (status === 401) return { state: 'auth', note: 'reachable; wants a token' };
  if (status === 403) return { state: 'down', note: 'forbidden — policy denied or lapsed' };
  if (status === 404) return { state: 'down', note: 'no such door or app' };
  if (status === 502 || status === 503 || status === 504) {
    return { state: 'down', note: `${status} — upstream down or a rollout in flight` };
  }
  // Includes a probe that produced no status at all: silence is not a pass.
  return { state: 'down', note: `unexpected status ${status}` };
}

const MARK = { ok: '✅', auth: '✅', down: '❌', unreachable: '❌' };

function renderTable(rows) {
  // An empty string reads like a clean run. Say what actually happened.
  if (!rows.length) return 'no doors probed — check the door configuration';
  const width = rows.reduce((w, r) => Math.max(w, r.label.length), 0);
  return rows
    .map((r) => {
      const mark = MARK[r.state] || '❌';
      const note = r.note ? `  ${r.note}` : '';
      return `${mark} ${r.label.padEnd(width)}  ${r.state.padEnd(11)}${note}`;
    })
    .join('\n');
}

function exitCodeFor(rows) {
  // `[].every()` is true, so an empty set would otherwise report success — a
  // door config that resolved to nothing would read as a clean preflight.
  if (!rows.length) return 1;
  return rows.every((r) => PASSING.has(r.state)) ? 0 : 1;
}

module.exports = { classifyProbe, renderTable, exitCodeFor };
