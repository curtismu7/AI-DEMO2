'use strict';

const { start, poll, decide } = require('../services/consentMockPhoneService');

const signedIn = () => ({ session: { user: { username: 'demouser' } } });
const body = { amount: 15000, type: 'transfer', description: 'Investment portfolio transfer' };

describe('consent mock phone (session-scoped CIBA stand-in)', () => {
  it('start holds a pending request with the transaction and a trace', () => {
    const req = signedIn();
    const view = start(req, body);
    expect(view).toMatchObject({ state: 'pending', loginHint: 'demouser', amount: 15000, type: 'transfer' });
    expect(view.trace.length).toBeGreaterThan(1);
    expect(JSON.stringify(view)).not.toMatch(/auth_req_id":"[a-f0-9-]{8}/);
    expect(poll(req).state).toBe('pending');
  });

  it('approve and deny finish the request and clear it', () => {
    for (const [decision, state] of [['approve', 'approved'], ['deny', 'denied']]) {
      const req = signedIn();
      start(req, body);
      expect(decide(req, decision)).toMatchObject({ state });
      expect(req.session.consentMockPhone).toBeUndefined();
    }
  });

  it('expires after the pending window', () => {
    const req = signedIn();
    start(req, body, { now: () => 0 });
    expect(poll(req, { now: () => 6 * 60 * 1000 }).state).toBe('expired');
  });

  it('rejects bad input and a decision with nothing pending', () => {
    expect(() => start(signedIn(), { ...body, amount: -1 })).toThrow(/amount/);
    expect(() => start(signedIn(), { ...body, type: 'wire' })).toThrow(/type/);
    expect(() => decide(signedIn(), 'approve')).toThrow(/pending/);
    const req = signedIn();
    start(req, body);
    expect(() => decide(req, 'maybe')).toThrow(/approve or deny/);
  });
});
