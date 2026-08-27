'use strict';

/**
 * Every rule gets a pair: it fires when it should, and it stays silent when it
 * shouldn't. A rule that has never been watched to fail is a guess.
 *
 * `now` is injected rather than read from the clock, so the two time-based
 * rules are deterministic instead of passing until the fixtures age out.
 */

const findings = require('../services/controlPlaneFindings');

const NOW = new Date('2026-08-27T12:00:00.000Z');

function ctx(over = {}) {
  return { now: NOW, rows: [], events: [], sources: {}, ...over };
}
function leaver(agentId, iso) {
  return { eventId: `e-${agentId}-${iso}`, agentId, eventType: 'leaver', timestamp: iso };
}

describe('repeat-revocation', () => {
  test('fires for an identity revoked twice inside the window', () => {
    const out = findings.evaluate(ctx({ events: [
      leaver('default-agent', '2026-08-12T00:00:00.000Z'),
      leaver('default-agent', '2026-08-10T20:49:40.788Z'),
    ] }));

    const f = out.find((x) => x.rule === 'repeat-revocation');
    expect(f).toBeDefined();
    expect(f.severity).toBe('critical');
    expect(f.evidence.agentId).toBe('default-agent');
    expect(f.evidence.count).toBe(2);
  });

  test('stays silent for a single revocation', () => {
    const out = findings.evaluate(ctx({ events: [leaver('demo-agent', '2026-08-11T09:29:54.929Z')] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });

  test('stays silent once the revocations fall outside the window', () => {
    // History is immutable, so an all-time rule could never clear and would
    // train the reader to ignore the queue. The signal is "recently".
    const out = findings.evaluate(ctx({ events: [
      leaver('old-agent', '2026-06-01T00:00:00.000Z'),
      leaver('old-agent', '2026-06-02T00:00:00.000Z'),
    ] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });

  test('counts per identity, not across identities', () => {
    const out = findings.evaluate(ctx({ events: [
      leaver('a', '2026-08-20T00:00:00.000Z'),
      leaver('b', '2026-08-21T00:00:00.000Z'),
    ] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });
});

describe('unverified-scopes', () => {
  test('fires once, summarising the count', () => {
    const out = findings.evaluate(ctx({ rows: [
      { id: 'a2a:banking', source: 'a2a', scopeStatus: 'unverified' },
      { id: 'a2a:retail', source: 'a2a', scopeStatus: 'unverified' },
      { id: 'app-1', source: 'pingone', scopeStatus: 'match' },
    ] }));

    const f = out.filter((x) => x.rule === 'unverified-scopes');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('advisory');
    expect(f[0].evidence.count).toBe(2);
  });

  test('stays silent when every row was actually compared', () => {
    const out = findings.evaluate(ctx({ rows: [
      { id: 'app-1', source: 'pingone', scopeStatus: 'match' },
      { id: 'app-2', source: 'pingone', scopeStatus: 'drift' },
    ] }));
    expect(out.some((x) => x.rule === 'unverified-scopes')).toBe(false);
  });
});

describe('stale-ledger', () => {
  test('fires when the newest event is older than the threshold', () => {
    const out = findings.evaluate(ctx({ events: [leaver('x', '2026-08-12T00:43:51.909Z')] }));

    const f = out.find((x) => x.rule === 'stale-ledger');
    expect(f).toBeDefined();
    expect(f.evidence.days).toBe(15);
  });

  test('stays silent when something was recorded recently', () => {
    const out = findings.evaluate(ctx({ events: [leaver('x', '2026-08-26T00:00:00.000Z')] }));
    expect(out.some((x) => x.rule === 'stale-ledger')).toBe(false);
  });

  test('stays silent on an empty ledger rather than reporting Infinity days', () => {
    // Nothing recorded ever is a different condition from "went quiet", and
    // reporting it as staleness would fire on a fresh install forever.
    const out = findings.evaluate(ctx({ events: [] }));
    expect(out.some((x) => x.rule === 'stale-ledger')).toBe(false);
  });
});

describe('source-down', () => {
  test('fires once per down source', () => {
    const out = findings.evaluate(ctx({ sources: {
      pingone: { state: 'down', error: 'PingOne unreachable' },
      a2a: { state: 'live' },
    } }));

    const f = out.filter((x) => x.rule === 'source-down');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('critical');
    expect(f[0].evidence.source).toBe('pingone');
  });

  test('does NOT fire for a not-wired source', () => {
    // The regression the four-state model exists to prevent: a stub is not an
    // outage, and collapsing them would light this rule up forever.
    const out = findings.evaluate(ctx({ sources: {
      p1az: { state: 'not-wired' },
      discovery: { state: 'structural' },
    } }));
    expect(out.some((x) => x.rule === 'source-down')).toBe(false);
  });
});

describe('declared structural facts', () => {
  test('are constants, not rules, and are never severity critical or advisory', () => {
    expect(findings.DECLARED.map((f) => f.id).sort())
      .toEqual(['discovery-has-no-source', 'no-alert-receiver']);
    expect(findings.DECLARED.every((f) => f.severity === 'structural')).toBe(true);
  });

  test('evaluate() does not emit them — they are not computed', () => {
    const out = findings.evaluate(ctx());
    expect(out.some((f) => f.severity === 'structural')).toBe(false);
  });
});
