/**
 * RFC 8693 Token Structure Validation for MCP Server
 *
 * Validates incoming MCP access tokens against RFC 8693 §3.2 response token requirements.
 * This is the MCP-server-side counterpart to banking_api_server/services/tokenStructureValidator.js.
 *
 * @module validateTokenAtGateway
 */

/**
 * Validate token claims per RFC 8693 for MCP server acceptance.
 *
 * @param {object} claims - Decoded JWT claims
 * @param {object} [options]
 * @param {string} [options.expectedAudience] - Expected aud claim (RFC 8693 §2.3)
 * @param {boolean} [options.requireAct] - If true, require act claim (RFC 8693 §2.2)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateTokenAtGateway(claims, options = {}) {
  const { expectedAudience, requireAct = false } = options;
  const errors = [];
  const warnings = [];

  if (!claims || typeof claims !== 'object') {
    return { valid: false, errors: ['Token claims missing or not an object'], warnings };
  }

  // RFC 8693 §3.2 — sub claim (subject identifier)
  if (!claims.sub) {
    errors.push('RFC 8693 §3.2: Missing sub claim');
  }

  // RFC 8693 §2.3 — aud claim (audience/resource)
  if (!claims.aud) {
    errors.push('RFC 8693 §2.3: Missing aud claim');
  } else if (expectedAudience) {
    const audValues = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audValues.includes(expectedAudience)) {
      errors.push(`RFC 8693 §2.3: aud mismatch — expected "${expectedAudience}", got "${claims.aud}"`);
    }
  }

  // RFC 8693 §2.2 — act claim (actor/delegation)
  if (requireAct && claims.act == null) {
    errors.push('RFC 8693 §2.2: Missing act claim — delegation expected');
  } else if (claims.act) {
    // act present — log for audit
    const actSub = typeof claims.act === 'object' ? claims.act.sub : claims.act;
    if (!actSub) {
      warnings.push('RFC 8693 §2.2: act claim present but has no sub identifier');
    }
  }

  // RFC 8693 §3.2 — exp claim
  if (!claims.exp) {
    errors.push('RFC 8693 §3.2: Missing exp claim');
  } else if (typeof claims.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      errors.push(`RFC 8693 §3.2: Token expired ${now - claims.exp}s ago`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Enforce the gateway-first next-hop token contract at the upstream MCP
 * server boundary (D-05, Phase 243).
 *
 * Used by the WebSocket/Express path (HTTP path uses HttpMCPTransport.enforceUpstreamContract).
 *
 * @param {object} claims - Decoded JWT claims
 * @param {object} [options]
 * @param {string} [options.upstreamAudience] - Expected aud for the upstream MCP server
 * @param {string} [options.gatewayAudience]  - Gateway aud to reject (anti-bypass D-05)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function enforceUpstreamContract(claims, { upstreamAudience, gatewayAudience } = {}) {
  const errors = [];

  const aud = claims?.aud;
  if (!aud) {
    errors.push('Missing aud claim — cannot enforce upstream contract');
    return { valid: false, errors };
  }

  const audValues = Array.isArray(aud) ? aud.map(String) : [String(aud)];

  // Rule 1: D-05 anti-bypass — reject gateway-audience tokens at the upstream
  if (gatewayAudience && audValues.includes(gatewayAudience)) {
    errors.push(
      `D-05 violation: gateway-audience token cannot be used at upstream ` +
      `(aud includes "${gatewayAudience}"). ` +
      `The gateway must perform RFC 8693 exchange before forwarding.`
    );
  }

  // Rule 2: upstream audience must match
  if (upstreamAudience && !audValues.includes(upstreamAudience)) {
    errors.push(
      `Upstream aud mismatch: expected "${upstreamAudience}", got [${audValues.join(', ')}]`
    );
  }

  return { valid: errors.length === 0, errors };
}
