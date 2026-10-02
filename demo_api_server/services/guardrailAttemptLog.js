'use strict';

/**
 * guardrailAttemptLog.js — in-memory ring buffer of recent Privilege LLM
 * guardrail verdicts (POST /api/privilege-mcp/llm/call), for the Agentic
 * Access Console's "Recent attempts" panel.
 *
 * Purely additive/observational: record() is called AFTER the real gateway
 * call already decided PERMIT/DENY/redact — nothing here influences that
 * decision. Entries carry real user-typed prompt text, so the read side
 * (GET /llm/guardrail-attempts) requires a signed-in session and shows a
 * non-admin only the attempts recorded under their own PingOne sub.
 *
 * ponytail: process-memory only, resets on restart, no persistence — a "recent
 * attempts" demo panel does not need a database. Upgrade to a store if this
 * ever needs to survive a restart or be shared across BFF instances.
 */

const MAX_ENTRIES = 20;
const entries = [];

/**
 * @param {object} attempt
 * @param {string} attempt.provider
 * @param {string} attempt.prompt
 * @param {'BLOCKED'|'SANITIZED'|'PASSED'} attempt.verdict
 * @param {string} [attempt.reason]
 * @param {string|null} [attempt.sub] PingOne sub of the caller; null when anonymous
 */
function record({ provider, prompt, verdict, reason, sub }) {
  entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    provider,
    prompt,
    verdict,
    reason: reason || null,
    sub: sub || null,
  });
  entries.length = Math.min(entries.length, MAX_ENTRIES);
}

/**
 * @param {string|null} [principal] omitted = every attempt (admin); a sub = that
 *   caller's own; null = none (a signed-in user with no resolvable sub must not
 *   inherit the anonymous attempts).
 */
function list(principal) {
  const pool = principal === undefined
    ? entries
    : entries.filter((e) => principal && e.sub === principal);
  return pool.map(({ sub, ...attempt }) => attempt);
}

module.exports = { record, list };
