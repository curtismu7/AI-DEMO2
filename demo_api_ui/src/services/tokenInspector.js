/**
 * Token inspection utilities for displaying JWT claims
 */

/**
 * JWT segments are base64url (`-`/`_`, no padding), not standard base64
 * (`+`/`/`, padded) — `atob` only accepts the latter, so convert first.
 */
function base64UrlToBase64(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

/**
 * Decode a JWT into its three parts.
 * Always returns an object — callers gate on `isValid` rather than null-checking.
 */
function decodeJWT(token) {
  if (!token || typeof token !== 'string') {
    return { isValid: false, error: 'Invalid token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { isValid: false, error: 'Invalid JWT format' };
  }
  try {
    return {
      isValid: true,
      header: JSON.parse(atob(base64UrlToBase64(parts[0]))),
      payload: JSON.parse(atob(base64UrlToBase64(parts[1]))),
      signature: parts[2],
    };
  } catch (err) {
    return { isValid: false, error: `Failed to decode JWT: ${err.message}` };
  }
}

/** Scopes live in `scope` or `scp`, each either space-delimited or an array. */
function extractScopes(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const claim = payload.scope ?? payload.scp;
  if (typeof claim === 'string') {
    return claim.split(' ').filter(Boolean);
  }
  if (Array.isArray(claim)) {
    return claim;
  }
  return [];
}

function formatTokenDisplay(payload) {
  const claims = payload && typeof payload === 'object' ? payload : {};
  return {
    scopes: extractScopes(claims),
    // PingOne uses the registered claims; some demo flows send the long names
    aud: claims.aud || claims.audience || null,
    sub: claims.sub || claims.subject || null,
    iss: claims.iss || claims.issuer || null,
    jti: claims.jti || null,
    exp: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    iat: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
    raw: claims,
  };
}

export { decodeJWT, extractScopes, formatTokenDisplay };
