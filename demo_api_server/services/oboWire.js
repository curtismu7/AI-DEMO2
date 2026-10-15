'use strict';
// Browser-safe description of the real PingOne hops for the /obo-demo page. Tokens are shown as-is
// (demo/training); client secrets, assertions and Basic credentials are always masked.
const MASK = '***';
// client_assertion_type only names the client-auth method (training value), so it stays real.
const isSecretKey = (key) => /secret|password|assertion/i.test(key) && key.toLowerCase() !== 'client_assertion_type';
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Form-encoded pairs (`k=v&k2=v2`) in a string body or a URL query: mask the value of secret-like keys.
const maskPairs = (text) => text.replace(/([^&=?#\s]+)=[^&#\s]*/g, (m, k) => (isSecretKey(k) ? `${k}=${MASK}` : m));

function maskDeep(value) {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecretKey(k) ? MASK : maskDeep(v)]));
  }
  return value;
}

function maskHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => {
    if (/^(proxy-)?authorization$/i.test(k) && /^basic\s/i.test(String(v))) return [k, 'Basic ***'];
    return [k, isSecretKey(k) ? MASK : v];
  }));
}

const maskUrl = (url) => (typeof url === 'string' && url.includes('?')
  ? url.replace(/\?([^#]*)/, (m, query) => `?${maskPairs(query)}`)
  : url);

function maskBody(body) {
  if (body instanceof URLSearchParams) return maskDeep(Object.fromEntries(body));
  if (typeof body === 'string') return maskPairs(body);
  return maskDeep(body);
}

function describeHop(info = {}) {
  const request = info.request || {};
  const response = info.response || {};
  return {
    request: { method: request.method, url: maskUrl(request.url), headers: maskHeaders(request.headers), body: maskBody(request.body) },
    response: { status: response.status, body: maskDeep(response.data) },
  };
}

function decodeToken(jwt) {
  try {
    const [header, payload] = String(jwt).split('.');
    const decoded = {
      header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    };
    return isPlainObject(decoded.header) && isPlainObject(decoded.payload) ? decoded : null;
  } catch (_e) {
    return null;
  }
}

const tokenBlock = (role, label, raw) => ({ role, label, raw, decoded: decodeToken(raw) });

// Steps 5 and 6 call the verifier in-process; say so rather than pretend it was a network call.
const downstreamHop = (token, result) => ({
  request: { method: 'GET', url: '/api/obo/downstream (in-process check, same logic as the route)', headers: { Authorization: `Bearer ${token}` }, body: null },
  response: { status: result.status, body: maskDeep(result) },
});

const withDetail = (step, wire, tokens) => ({ ...step, ...(wire ? { wire } : {}), ...(tokens ? { tokens } : {}) });

module.exports = { MASK, describeHop, decodeToken, tokenBlock, downstreamHop, withDetail };
