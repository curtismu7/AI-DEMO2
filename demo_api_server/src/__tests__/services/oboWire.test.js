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
});
