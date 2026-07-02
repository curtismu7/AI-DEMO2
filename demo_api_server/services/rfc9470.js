/**
 * rfc9470.js — OAuth 2.0 Step-Up Authentication Challenge (RFC 9470).
 *
 * Builds and parses the WWW-Authenticate Bearer challenge that tells a client
 * "your token is valid, but the user authentication behind it is not strong
 * or fresh enough". The client re-runs the authorization request passing
 * acr_values / max_age through as standard OIDC parameters.
 *
 *   WWW-Authenticate: Bearer error="insufficient_user_authentication",
 *     error_description="...", acr_values="Multi_Factor", max_age="300"
 */

'use strict';

const INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication';

/** Quote a param value per RFC 7235 quoted-string (escape backslash + dquote). */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Build the WWW-Authenticate header value for an RFC 9470 step-up challenge.
 * @param {object} [opts]
 * @param {string[]} [opts.acrValues] - required ACR values (space-separated in the header; any one satisfies)
 * @param {number} [opts.maxAge] - max seconds since auth_time; 0 means "force fresh auth"; omit to leave out
 * @param {string} [opts.errorDescription]
 * @returns {string}
 */
function buildChallengeHeader({ acrValues = [], maxAge, errorDescription } = {}) {
  const params = [`error=${quote(INSUFFICIENT_USER_AUTHENTICATION)}`];
  if (errorDescription) params.push(`error_description=${quote(errorDescription)}`);
  if (acrValues.length > 0) params.push(`acr_values=${quote(acrValues.join(' '))}`);
  if (maxAge !== undefined && maxAge !== null) params.push(`max_age=${quote(maxAge)}`);
  return `Bearer ${params.join(', ')}`;
}

/**
 * Parse a WWW-Authenticate Bearer challenge value.
 * @param {string} value
 * @returns {{ scheme: 'Bearer', error: string, error_description?: string,
 *             acr_values?: string[], max_age?: number } | null}
 *          null when not a Bearer challenge or no error param present.
 */
function parseChallengeHeader(value) {
  if (typeof value !== 'string' || !/^Bearer\s/i.test(value.trim())) return null;
  const paramsPart = value.trim().replace(/^Bearer\s+/i, '');
  const out = { scheme: 'Bearer' };
  const re = /([a-zA-Z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(paramsPart)) !== null) {
    const key = m[1];
    const raw = m[2].replace(/\\(.)/g, '$1');
    if (key === 'acr_values') out.acr_values = raw.split(/\s+/).filter(Boolean);
    else if (key === 'max_age') out.max_age = Number(raw);
    else out[key] = raw;
  }
  return out.error ? out : null;
}

module.exports = { buildChallengeHeader, parseChallengeHeader, INSUFFICIENT_USER_AUTHENTICATION };
