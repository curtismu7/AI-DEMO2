/**
 * Token inspection utilities for displaying JWT claims
 */

function decodeJWT(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (err) {
    return null;
  }
}

function extractScopes(token) {
  if (!token) return [];
  if (typeof token.scope === 'string') {
    return token.scope.split(' ').filter(Boolean);
  }
  if (Array.isArray(token.scope)) {
    return token.scope;
  }
  return [];
}

function formatTokenDisplay(payload) {
  return {
    scopes: extractScopes(payload),
    aud: payload.aud || null,
    sub: payload.sub || null,
    iss: payload.iss || null,
    exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
  };
}

export { decodeJWT, extractScopes, formatTokenDisplay };
