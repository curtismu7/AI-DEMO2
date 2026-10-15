'use strict';
// Browser-safe description of the real PingOne hops for the /obo-demo page. Tokens are shown as-is
// (demo/training); client secrets, assertions and Basic credentials are always masked.
const MASK = '***';
const isSecretKey = (key) => /secret|password|assertion/i.test(key);

function maskDeep(value) {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecretKey(k) ? MASK : maskDeep(v)]));
  }
  return value;
}

function maskHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => (
    /^authorization$/i.test(k) && /^basic\s/i.test(String(v)) ? [k, 'Basic ***'] : [k, v]
  )));
}

function describeHop(info = {}) {
  const request = info.request || {};
  const response = info.response || {};
  return {
    request: { method: request.method, url: request.url, headers: maskHeaders(request.headers), body: maskDeep(request.body) },
    response: { status: response.status, body: maskDeep(response.data) },
  };
}

function decodeToken(jwt) {
  try {
    const [header, payload] = String(jwt).split('.');
    return {
      header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    };
  } catch (_e) {
    return null;
  }
}

const tokenBlock = (role, label, raw) => ({ role, label, raw, decoded: decodeToken(raw) });

// Steps 5 and 6 call the verifier in-process; say so rather than pretend it was a network call.
const downstreamHop = (token, result) => ({
  request: { method: 'GET', url: '/api/obo/downstream (in-process check, same logic as the route)', headers: { Authorization: `Bearer ${token}` }, body: null },
  response: { status: result.status, body: result },
});

const withDetail = (step, wire, tokens) => ({ ...step, ...(wire ? { wire } : {}), ...(tokens ? { tokens } : {}) });

module.exports = { MASK, describeHop, decodeToken, tokenBlock, downstreamHop, withDetail };
