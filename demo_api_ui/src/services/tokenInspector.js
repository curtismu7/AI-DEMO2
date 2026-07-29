function decodeJWT(token) {
  if (!token || typeof token !== 'string') {
    return { header: null, payload: null, signature: null, isValid: false, error: 'Invalid token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { header: null, payload: null, signature: null, isValid: false, error: 'Invalid JWT format' };
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const signature = parts[2];

    return {
      header,
      payload,
      signature,
      isValid: true
    };
  } catch (err) {
    return { header: null, payload: null, signature: null, isValid: false, error: err.message };
  }
}

function base64UrlDecode(str) {
  let output = str.replace(/-/g, '+').replace(/_/g, '/');
  switch (output.length % 4) {
    case 0:
      break;
    case 2:
      output += '==';
      break;
    case 3:
      output += '=';
      break;
    default:
      throw new Error('Invalid base64url string');
  }

  try {
    return decodeURIComponent(
      atob(output)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch (err) {
    throw new Error('Failed to decode base64url: ' + err.message);
  }
}

function extractScopes(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const scope = payload.scope || payload.scp || '';
  if (typeof scope === 'string') {
    return scope.split(' ').filter(s => s.length > 0);
  }

  return Array.isArray(scope) ? scope : [];
}

function formatTokenDisplay(payload) {
  if (!payload || typeof payload !== 'object') {
    return { scopes: [], aud: null, exp: null, sub: null, iss: null };
  }

  return {
    scopes: extractScopes(payload),
    aud: payload.aud || payload.audience || null,
    exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    sub: payload.sub || payload.subject || null,
    iss: payload.iss || payload.issuer || null,
    jti: payload.jti || null,
    raw: payload
  };
}

export {
  decodeJWT,
  extractScopes,
  formatTokenDisplay
};
