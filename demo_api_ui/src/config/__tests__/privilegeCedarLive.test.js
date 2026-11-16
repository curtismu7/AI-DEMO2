import { describe, expect, it } from 'vitest';
import { LIVE_PATH, STEPS, MEASURED, NOT_MEASURED, holdState, interpretRun, scopeGate } from '../privilegeCedarLive';
import { ACT_SUB_NOT_MEASURED } from '../privilegePfTokenDemo';
import { NAV_PAGE_PATHS } from '../navPagePaths';
import { NAV_STRUCTURE_CATALOG } from '../navStructureCatalog';

describe('interpretRun', () => {
  it('treats 401 as signed out and 503 as the missing secret', () => {
    expect(interpretRun({ status: 401, data: {} })).toEqual({ signedOut: true });
    expect(interpretRun({ status: 503, data: {} }).problem).toContain('PF_TOKEN_DEMO_CLIENT_SECRET');
  });

  it('is usable with both gateway answers, or with a mint error shown on its own', () => {
    const both = { pfToken: {}, garbage: {} };
    expect(interpretRun({ status: 200, data: both })).toEqual({ data: both });
    const mint = { mint: { error: 'invalid_client' } };
    expect(interpretRun({ status: 200, data: mint })).toEqual({ data: mint });
  });

  it.each([
    [500, {}, 'The run did not return a result (HTTP 500).'],
    [500, { error: 'upstream_failed' }, 'upstream_failed'],
    [502, { message: 'The gateway timed out.' }, 'The gateway timed out.'],
    [200, { at: 'now', mint: { status: 200 } }, 'did not return a result (HTTP 200)'],
    [undefined, undefined, 'did not return a result'],
  ])('reports status %s with body %j as a problem', (status, data, text) => {
    expect(interpretRun({ status, data }).problem).toContain(text);
  });
});

describe('scopeGate', () => {
  const blocked = (key) => ({ key, verdict: 'blocked-by-cedar' });
  const allowed = (key) => ({ key, verdict: 'allowed' });
  it('is enforcing only when without is refused by Cedar and with is allowed', () => {
    expect(scopeGate([blocked('without'), allowed('with')]).state).toBe('enforcing');
    expect(scopeGate([allowed('with'), blocked('without')]).state).toBe('enforcing');
  });
  it('is not enforcing when every case is allowed', () => {
    expect(scopeGate([allowed('without'), allowed('with')]).state).toBe('not-enforcing');
  });
  it.each([
    ['reversed', [allowed('without'), blocked('with')]],
    ['both refused', [blocked('without'), blocked('with')]],
    ['a rejected token', [{ key: 'without', verdict: 'token-rejected' }, allowed('with')]],
    ['a missing case', [blocked('without')]],
  ])('is unexpected for %s', (_n, cases) => {
    expect(scopeGate(cases).state).toBe('unexpected');
  });
  it('has no result for a missing or empty list', () => {
    expect(scopeGate(undefined).state).toBe('none');
    expect(scopeGate([]).state).toBe('none');
  });
});

describe('holdState', () => {
  it('names the two expected moments and never calls a plain allow the gate working', () => {
    expect(holdState({ outcome: 'hold' })).toBe('held');
    expect(holdState({ outcome: 'hold', previous: 'hold' })).toBe('held');
    expect(holdState({ outcome: 'allow', previous: 'hold' })).toBe('approved-retry');
    expect(holdState({ outcome: 'allow', previous: null })).toBe('not-held');
    expect(holdState({ outcome: 'allow' })).toBe('not-held');
  });
  it('separates sign-in from every other outcome', () => {
    expect(holdState({ outcome: 'signin' })).toBe('signin');
    for (const outcome of ['deny', 'tool-error', 'error']) expect(holdState({ outcome })).toBe('other');
  });
});

describe('content', () => {
  it('has three steps in order with an expectation, a sign-in need and a measured note', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['hold', 'scope', 'actsub']);
    for (const s of STEPS) for (const k of ['kicker', 'title', 'expect', 'expectWord', 'needs', 'measured']) expect(s[k]).toBeTruthy();
  });
  it('carries every act.sub gap the PingFederate token page records, and says the 7 seconds is one observation', () => {
    for (const g of ACT_SUB_NOT_MEASURED) expect(NOT_MEASURED).toContain(g);
    expect(MEASURED.join(' ')).toMatch(/one observation, not a propagation time/);
  });
});

describe('registration of the live tour', () => {
  it('has a nav path and a catalog entry under the label the side nav uses', () => {
    expect(NAV_PAGE_PATHS['Cedar in Privilege (live)']).toBe(LIVE_PATH);
    const labels = JSON.stringify(NAV_STRUCTURE_CATALOG);
    expect(labels).toContain('"Cedar in Privilege (live)"');
  });
});

describe('interpretRun needs both gateway answers', () => {
  it('a body with the token answer but no rejected-token control is not a usable run', () => {
    expect(interpretRun({ status: 200, data: { pfToken: {} } }).problem).toContain('did not return a result (HTTP 200)');
  });
});
