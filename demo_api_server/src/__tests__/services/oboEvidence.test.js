'use strict';
const { buildEvidence, hasTokenLeak, sha } = require('../../../services/oboEvidence');

const jwt = (payload) =>
  ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

const AGENT = 'f65664b2-e515-45ee-b99b-4f04ad136e74';
const user = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], scope: 'mcp:invoke', client_id: 'c8392dc4' });
const good = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', act: { client_id: AGENT }, exp: 9999999999 });
const ok = { delegated: 200, userToken: 401 };
const byId = (ev, id) => ev.checks.find((c) => c.id === id);

describe('buildEvidence', () => {
  test('all 7 checks pass for a correct delegation', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: ok });
    expect(ev.checks).toHaveLength(7);
    expect(ev.checks.every((c) => c.pass)).toBe(true);
    expect(ev.sub).toBe('u1');
    expect(ev.delegated.act).toEqual({ client_id: AGENT });
    expect(ev.leak).toBe(false);
  });

  test('never contains the raw tokens', () => {
    const ev = buildEvidence({ source: 'page', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: ok });
    const text = JSON.stringify(ev);
    expect(text).not.toContain(user);
    expect(text).not.toContain(good);
    expect(ev.inbound.sha).toBe(sha(user));
  });

  test('act as a bare string fails the act check', () => {
    const str = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], act: AGENT });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: str, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'act-object').pass).toBe(false);
  });

  test('act naming a different client fails the act check', () => {
    const other = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], act: { client_id: 'someone-else' } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: other, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'act-object').pass).toBe(false);
  });

  test('different subject fails the sub check', () => {
    const other = jwt({ sub: 'u2', aud: ['obo-demo.ping.demo'], act: { client_id: AGENT } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: other, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'sub-preserved').pass).toBe(false);
  });

  test('same audience as the user token fails the audience check', () => {
    const same = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], act: { client_id: AGENT } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: same, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'aud-differs').pass).toBe(false);
  });

  test('downstream accepting the user token fails the refusal check', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: { delegated: 200, userToken: 200 } });
    expect(byId(ev, 'downstream-refuses-user').pass).toBe(false);
  });

  test('downstream rejecting the delegated token fails the acceptance check', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: { delegated: 401, userToken: 401 } });
    expect(byId(ev, 'downstream-accepts-delegated').pass).toBe(false);
  });
});

describe('hasTokenLeak', () => {
  test('detects a JWT-shaped string anywhere in a value', () => {
    expect(hasTokenLeak({ a: { b: `x ${good} y` } })).toBe(true);
  });
  test('detects a planted secret that is not JWT-shaped', () => {
    expect(hasTokenLeak({ msg: 'opaque-token-123' }, ['opaque-token-123'])).toBe(true);
  });
  test('clean claims are not a leak', () => {
    expect(hasTokenLeak({ sub: 'u1', aud: ['x'] })).toBe(false);
  });
});
