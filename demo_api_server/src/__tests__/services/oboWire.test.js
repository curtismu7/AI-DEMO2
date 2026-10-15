'use strict';
const { describeHop, decodeToken, tokenBlock, downstreamHop, withDetail, MASK } = require('../../../services/oboWire');

const jwt = (header, payload) => [Buffer.from(JSON.stringify(header)).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const delegated = jwt({ alg: 'RS256', kid: 'k1' }, { sub: 'u1', act: { client_id: 'AGENT' }, aud: ['obo-demo.ping.demo'] });

describe('describeHop', () => {
  const info = {
    request: {
      method: 'POST', url: 'https://auth.pingone.com/env/as/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic c2VjcmV0LXN0dWZm' },
      body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', client_id: 'ex', client_secret: 'PLANTED-SECRET', subject_token: 'SUBJECT.JWT.X', actor_assertion: 'ASSERT', nested: { api_secret: 'PLANTED-2' } },
    },
    response: { status: 200, data: { access_token: delegated, token_type: 'Bearer', expires_in: 900 } },
  };

  test('masks client_secret, *_secret, *assertion* and Basic credentials, everywhere', () => {
    const hop = describeHop(info);
    const text = JSON.stringify(hop);
    expect(hop.request.body.client_secret).toBe(MASK);
    expect(hop.request.body.actor_assertion).toBe(MASK);
    expect(hop.request.body.nested.api_secret).toBe(MASK);
    expect(hop.request.headers.Authorization).toBe('Basic ***');
    for (const planted of ['PLANTED-SECRET', 'PLANTED-2', 'c2VjcmV0LXN0dWZm', 'ASSERT']) expect(text).not.toContain(planted);
  });

  test('keeps tokens and ordinary fields real', () => {
    const hop = describeHop(info);
    expect(hop.request.body.subject_token).toBe('SUBJECT.JWT.X');
    expect(hop.response.body.access_token).toBe(delegated);
    expect(hop).toMatchObject({ request: { method: 'POST', url: 'https://auth.pingone.com/env/as/token' }, response: { status: 200 } });
  });

  test('keeps a Bearer Authorization header (the downstream check shows it)', () => {
    const hop = describeHop({ request: { method: 'GET', url: '/x', headers: { Authorization: `Bearer ${delegated}` } }, response: { status: 200, data: {} } });
    expect(hop.request.headers.Authorization).toBe(`Bearer ${delegated}`);
  });

  test('tolerates a missing request/response', () => {
    expect(describeHop({})).toEqual({ request: { method: undefined, url: undefined, headers: {}, body: undefined }, response: { status: undefined, body: undefined } });
  });
});

describe('decodeToken / tokenBlock', () => {
  test('decodes header and payload', () => {
    expect(decodeToken(delegated)).toEqual({ header: { alg: 'RS256', kid: 'k1' }, payload: { sub: 'u1', act: { client_id: 'AGENT' }, aud: ['obo-demo.ping.demo'] } });
  });
  test('returns null for malformed input instead of throwing', () => {
    expect(decodeToken('not-a-jwt')).toBeNull();
    expect(decodeToken(undefined)).toBeNull();
  });
  test('tokenBlock carries role, label, raw and decoded', () => {
    expect(tokenBlock('delegated', 'Delegated token', delegated)).toMatchObject({ role: 'delegated', label: 'Delegated token', raw: delegated, decoded: { header: { alg: 'RS256' } } });
  });
});

describe('downstreamHop / withDetail', () => {
  test('labels the in-process check and shows the Authorization header and the verifier JSON', () => {
    const hop = downstreamHop(delegated, { status: 200, acting_for: 'u1', acted_by: { client_id: 'AGENT' } });
    expect(hop.request.method).toBe('GET');
    expect(hop.request.url).toMatch(/in-process/);
    expect(hop.request.headers.Authorization).toBe(`Bearer ${delegated}`);
    expect(hop.response).toEqual({ status: 200, body: { status: 200, acting_for: 'u1', acted_by: { client_id: 'AGENT' } } });
  });
  test('withDetail adds only what is given', () => {
    expect(withDetail({ id: 1 }, null, null)).toEqual({ id: 1 });
    expect(withDetail({ id: 1 }, { request: {} }, [{ role: 'user' }])).toEqual({ id: 1, wire: { request: {} }, tokens: [{ role: 'user' }] });
  });
  test('masks secret-like keys in the verifier result (defense in depth)', () => {
    const hop = downstreamHop(delegated, { status: 200, client_secret: 'PLANTED' });
    expect(hop.response.body.client_secret).toBe(MASK);
    expect(JSON.stringify(hop)).not.toContain('PLANTED');
    expect(hop.request.headers.Authorization).toBe(`Bearer ${delegated}`);
  });
});

describe('fail-closed masking of string bodies, URLs, secret headers and decoded tokens', () => {
  test('masks secret-like pairs in a form-encoded string body', () => {
    const hop = describeHop({ request: { method: 'POST', url: '/t', body: 'grant_type=x&client_secret=PLANTED&scope=a' } });
    expect(hop.request.body).toBe('grant_type=x&client_secret=***&scope=a');
    expect(JSON.stringify(hop)).not.toContain('PLANTED');
  });
  test('leaves a string body with no secrets unchanged', () => {
    expect(describeHop({ request: { body: 'grant_type=x&scope=a' } }).request.body).toBe('grant_type=x&scope=a');
  });
  test('keeps client_assertion_type real but masks client_assertion in a string body', () => {
    const hop = describeHop({ request: { body: 'client_assertion_type=urn%3Ajwt-bearer&client_assertion=PLANTED' } });
    expect(hop.request.body).toBe('client_assertion_type=urn%3Ajwt-bearer&client_assertion=***');
  });
  test('masks secret-like keys of a URLSearchParams body', () => {
    const body = new URLSearchParams({ grant_type: 'x', client_secret: 'PLANTED' });
    const hop = describeHop({ request: { body } });
    expect(hop.request.body).toEqual({ grant_type: 'x', client_secret: MASK });
    expect(JSON.stringify(hop)).not.toContain('PLANTED');
  });
  test('scrubs secret-like query parameters from the url', () => {
    expect(describeHop({ request: { url: 'https://x/token?client_secret=PLANTED&a=1' } }).request.url).toBe('https://x/token?client_secret=***&a=1');
  });
  test('leaves a url without a query unchanged and passes a non-string url through', () => {
    expect(describeHop({ request: { url: 'https://x/token' } }).request.url).toBe('https://x/token');
    expect(describeHop({ request: { url: 42 } }).request.url).toBe(42);
  });
  test('masks any secret-like header key, case-insensitively', () => {
    const hop = describeHop({ request: { headers: { 'X-API-Secret': 'PLANTED', 'x-api-secret-two': 'PLANTED' } } });
    expect(hop.request.headers['X-API-Secret']).toBe(MASK);
    expect(hop.request.headers['x-api-secret-two']).toBe(MASK);
  });
  test('masks Proxy-Authorization Basic credentials but keeps Bearer real', () => {
    const hop = describeHop({ request: { headers: { 'Proxy-Authorization': 'Basic c2VjcmV0', 'proxy-authorization': 'Bearer KEEP', Authorization: 'Bearer KEEP2' } } });
    expect(hop.request.headers['Proxy-Authorization']).toBe('Basic ***');
    expect(hop.request.headers['proxy-authorization']).toBe('Bearer KEEP');
    expect(hop.request.headers.Authorization).toBe('Bearer KEEP2');
  });
});

describe('decodeToken requires both header and payload to be objects', () => {
  test('returns null when the payload decodes to a string', () => {
    expect(decodeToken(jwt({ alg: 'RS256' }, 'x'))).toBeNull();
  });
  test('returns null when the payload decodes to null', () => {
    expect(decodeToken(jwt({ alg: 'RS256' }, null))).toBeNull();
  });
  test('returns null when the header is an array', () => {
    expect(decodeToken(jwt([1], { sub: 'u1' }))).toBeNull();
  });
});
