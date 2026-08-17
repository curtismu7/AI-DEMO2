// demo_llm_proxy/promptRedact.js
'use strict';
/**
 * Redact PII/secrets from LLM prompt/completion text before it is written to
 * the shared transaction ledger (see promptFlowHop.js's `llm.call` hop).
 *
 * Ported from demo_api_server/utils/logRedact.js's JWT regex and
 * `[REDACTED_*]`-placeholder convention. logRedact.js otherwise redacts by
 * OBJECT KEY NAME (its SECRET_KEY_RE), which only applies to structured log
 * objects — free-text chat prompts/completions have no keys, so SSN/card/
 * email/bearer-token regexes are added here, matching the categories the
 * prompt-flow-inspector design spec (§3) calls for. This is the canonical
 * rule set the langchain_agent Python port should mirror.
 */

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const MAX_REDACTED_CHARS = 4000;
const TRUNCATION_SUFFIX = '…[truncated]';

/**
 * @param {unknown} rawText
 * @returns {string} redacted text, capped at MAX_REDACTED_CHARS. Never
 *   throws — on any failure returns "[redaction-error, content omitted]",
 *   never raw content.
 */
function redactText(rawText) {
  try {
    const text = typeof rawText === 'string' ? rawText : (rawText == null ? '' : String(rawText));
    if (!text) return '';
    let out = text
      .replace(JWT_RE, '[REDACTED_JWT]')
      .replace(BEARER_TOKEN_RE, 'Bearer [REDACTED_TOKEN]')
      .replace(SSN_RE, '[REDACTED_SSN]')
      .replace(CARD_RE, '[REDACTED_CARD]')
      .replace(EMAIL_RE, '[REDACTED_EMAIL]');
    if (out.length > MAX_REDACTED_CHARS) {
      out = `${out.slice(0, MAX_REDACTED_CHARS)}${TRUNCATION_SUFFIX}`;
    }
    return out;
  } catch {
    return '[redaction-error, content omitted]';
  }
}

module.exports = { redactText, MAX_REDACTED_CHARS };
