/**
 * wwwAuthenticate.js — parse RFC 9470 step-up challenges.
 *
 * When ff_rfc9470_challenge is ON, the BFF signals step-up as
 *   401 + WWW-Authenticate: Bearer error="insufficient_user_authentication",
 *   acr_values="...", max_age="..."
 * instead of the legacy 428 + JSON body. extractRfc9470Challenge() normalizes
 * that into the same shape beginStepUp() already consumes.
 */

const INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication';

/** Parse a WWW-Authenticate Bearer value into its params. Null if not Bearer. */
export function parseWwwAuthenticate(value) {
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
  return out;
}

/**
 * Extract a normalized step-up descriptor from an axios error.response when
 * the server used the RFC 9470 401 challenge. Returns an object shaped like
 * the legacy 428 body (beginStepUp-compatible) with an extra `rfc9470` member
 * carrying the raw header + parsed params — or null when the response is not
 * an RFC 9470 step-up challenge (ordinary 401s fall through untouched).
 */
export function extractRfc9470Challenge(response) {
  if (!response || response.status !== 401) return null;
  const headerValue = response.headers?.['www-authenticate'] || null;
  const body = response.data && typeof response.data === 'object' ? response.data : {};
  const parsed = headerValue ? parseWwwAuthenticate(headerValue) : null;

  if (parsed?.error === INSUFFICIENT_USER_AUTHENTICATION) {
    return {
      ...body,
      error: body.error || 'step_up_required',
      step_up_acr: parsed.acr_values?.[0] || body.step_up_acr || '',
      rfc9470: { raw: headerValue, ...parsed },
    };
  }

  // Demo resilience: RFC-mode body without a readable/parseable header
  // (e.g. a proxy stripped it). Fall back to the JSON body fields.
  if (body.error === 'step_up_required') {
    console.warn(
      '[rfc9470] 401 step-up response without a parseable WWW-Authenticate header — falling back to body fields'
    );
    return { ...body };
  }

  return null;
}
