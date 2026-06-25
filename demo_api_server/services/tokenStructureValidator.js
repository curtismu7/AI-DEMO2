/**
 * Token Structure Validator — validates JWT claims per RFC 8693
 *
 * RFC 8693 Requirements Checked:
 * - §2.1: subject_token → sub claim must be present
 * - §2.2: actor_token → act claim must be present in delegation flows
 * - §2.3: resource/audience → aud claim must match expected audience
 * - §3.2: response token → sub, aud, exp, scope validated
 *
 * See docs/RFC8693_MCP_VALIDATION_MATRIX.md for full compliance mapping.
 * See docs/TOKEN_TERMINOLOGY_GLOSSARY.md for term definitions.
 *
 * @module tokenStructureValidator
 */

/**
 * Validate decoded JWT token claims against RFC 8693 requirements.
 *
 * @param {object} token - Decoded JWT payload (claims object)
 * @param {object} [options={}] - Validation options
 * @param {string} [options.expectedAudience] - Expected aud claim value (RFC 8693 §2.3)
 * @param {string[]} [options.expectedScopes=[]] - Required scopes in token
 * @param {boolean} [options.isDelegationFlow=false] - If true, act claim is mandatory (RFC 8693 §2.2)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateTokenStructure(token, options = {}) {
  const { expectedAudience, expectedScopes = [], isDelegationFlow = false } = options;
  const errors = [];
  const warnings = [];

  // Guard: token must exist
  if (!token || typeof token !== 'object') {
    errors.push('Token is null, undefined, or not an object');
    return { valid: false, errors, warnings };
  }

  // RFC 8693 §3.2 — sub claim (subject identifier)
  if (!token.sub) {
    errors.push('RFC 8693 §3.2: Missing sub claim (required — identifies subject/user)');
  } else if (typeof token.sub !== 'string' || token.sub.trim().length === 0) {
    errors.push('RFC 8693 §3.2: sub claim must be a non-empty string');
  }

  // RFC 8693 §2.3 — aud claim (audience/resource)
  if (!token.aud) {
    errors.push('RFC 8693 §2.3: Missing aud claim (required — identifies target resource)');
  }

  // RFC 8693 §2.3 — Audience value validation
  if (expectedAudience && token.aud) {
    const audValues = Array.isArray(token.aud) ? token.aud : [token.aud];
    if (!audValues.includes(expectedAudience)) {
      errors.push(
        `RFC 8693 §2.3: aud claim mismatch — expected "${expectedAudience}" but got "${token.aud}"`
      );
    }
  }

  // RFC 8693 §2.2 / §4.1 — act claim (actor identifier in delegation)
  if (isDelegationFlow) {
    if (token.act == null) {
      errors.push(
        'RFC 8693 §2.2: Missing act claim (required in delegation flow — identifies actor/agent)'
      );
    } else if (typeof token.act === 'string' && token.act.trim().length === 0) {
      errors.push('RFC 8693 §2.2: act claim must be non-empty');
    }
    // act can be string or object { sub: "..." } per RFC 8693 §4.1
  } else if (!token.act) {
    warnings.push(
      'RFC 8693 §2.2: act claim not present (info — expected in dual-exchange flows)'
    );
  }

  // RFC 8693 §3.2 — exp claim (expiration)
  if (!token.exp) {
    errors.push('RFC 8693 §3.2: Missing exp claim (required — token expiry timestamp)');
  } else if (typeof token.exp !== 'number') {
    errors.push('RFC 8693 §3.2: exp claim must be a number (Unix timestamp)');
  } else {
    const now = Math.floor(Date.now() / 1000);
    if (token.exp < now) {
      errors.push(
        `RFC 8693 §3.2: Token expired (exp=${token.exp}, now=${now})`
      );
    } else if (token.exp - now < 60) {
      warnings.push(`Token expires in < 1 minute (exp=${token.exp})`);
    }
  }

  // Scope validation (when expected scopes provided)
  if (expectedScopes.length > 0) {
    const tokenScopes = typeof token.scope === 'string'
      ? token.scope.split(' ').filter(Boolean)
      : [];
    const missing = expectedScopes.filter(s => !tokenScopes.includes(s));
    if (missing.length > 0) {
      errors.push(
        `Token missing required scope(s): ${missing.join(', ')} (has: ${tokenScopes.join(', ') || 'none'})`
      );
    }
  } else if (!token.scope) {
    warnings.push('Token has no scope claim');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

module.exports = { validateTokenStructure };
