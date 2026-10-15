import { describe, expect, it } from 'vitest';
import { mapInvokeResult } from '../dotChat';

describe('mapInvokeResult', () => {
  it('successful reply: dot bubble + PERMIT card per tool, memories passed through', () => {
    const r = mapInvokeResult(200, { reply: 'Booked.', success: true, toolsCalled: ['book_flight'], dotMemories: ['aisle seats'] });
    expect(r.signedOut).toBe(false);
    expect(r.items).toEqual([
      { kind: 'tool', name: 'book_flight', verdict: 'PERMIT' },
      { kind: 'dot', text: 'Booked.' },
    ]);
    expect(r.memories).toEqual(['aisle seats']);
  });

  it('gateway deny arrives as 200 + success:false: DENY, with the reply as the reason (not PERMIT)', () => {
    const r = mapInvokeResult(200, { reply: '❌ access_denied', success: false, toolsCalled: ['get_my_accounts'], mcpAuthorizeEvaluation: { decision: 'DENY' } });
    expect(r.items[0]).toMatchObject({ kind: 'tool', name: 'get_my_accounts', verdict: 'DENY', reason: '❌ access_denied' });
    expect(r.items.some((i) => i.kind === 'dot')).toBe(false);
  });

  it('403 intent_not_authorized: DENY card with the server message', () => {
    const r = mapInvokeResult(403, { error: 'intent_not_authorized', message: 'Transfers are not delegated to Dot.', intent: 'transfer_miles' });
    expect(r.items).toEqual([{ kind: 'tool', name: 'transfer_miles', verdict: 'DENY', reason: 'Transfers are not delegated to Dot.' }]);
  });

  it('428 requiresConsent: CONSENT card naming the action', () => {
    const r = mapInvokeResult(428, { requiresConsent: true, action: 'book_flight', message: 'Approve this booking.' });
    expect(r.items).toEqual([{ kind: 'tool', name: 'book_flight', verdict: 'CONSENT', reason: 'Approve this booking.' }]);
  });

  it('401: signedOut, no items', () => {
    expect(mapInvokeResult(401, { error: 'authentication_required' })).toEqual({ signedOut: true, items: [], memories: [] });
  });

  it('5xx / unreadable body: one error bubble, never a verdict', () => {
    expect(mapInvokeResult(500, {}).items).toEqual([{ kind: 'error', text: 'Dot could not complete that request.' }]);
    expect(mapInvokeResult(200, null).items).toEqual([{ kind: 'error', text: 'Dot could not complete that request.' }]);
  });

  it('reply with no toolsCalled: just the dot bubble', () => {
    expect(mapInvokeResult(200, { reply: 'Hi.', success: true, toolsCalled: [] }).items).toEqual([{ kind: 'dot', text: 'Hi.' }]);
  });

  it('200 + need_auth guest reply: signedOut, no Dot bubble', () => {
    const r = mapInvokeResult(200, { success: false, need_auth: true, requiresLogin: true, toolsCalled: [], reply: 'Please sign in to use the banking agent' });
    expect(r).toEqual({ signedOut: true, items: [], memories: [] });
  });

  it('200 + requiresConsent / hitl_required: CONSENT card per tool, not DENY', () => {
    const r = mapInvokeResult(200, { success: false, requiresConsent: true, error: 'hitl_required', toolsCalled: ['book_flight'], reply: 'Approve this.' });
    expect(r.signedOut).toBe(false);
    expect(r.items).toEqual([{ kind: 'tool', name: 'book_flight', verdict: 'CONSENT', reason: 'Approve this.' }]);
    expect(mapInvokeResult(200, { success: false, error: 'hitl_required', toolsCalled: ['x'], reply: 'r' }).items[0].verdict).toBe('CONSENT');
  });

  it('plain success:false with tools stays DENY', () => {
    expect(mapInvokeResult(200, { success: false, toolsCalled: ['x'], reply: 'no' }).items[0].verdict).toBe('DENY');
  });

  it('a model/gateway timeout (502/503/504) says so and points at Heuristics, instead of the generic failure', () => {
    for (const status of [502, 503, 504]) {
      const [item] = mapInvokeResult(status, {}).items;
      expect(item.kind).toBe('error');
      expect(item.text).toMatch(/model/i);
      expect(item.text).toMatch(/Heuristics/);
    }
    // other failures keep the generic message
    expect(mapInvokeResult(500, {}).items[0].text).toBe('Dot could not complete that request.');
  });
});
