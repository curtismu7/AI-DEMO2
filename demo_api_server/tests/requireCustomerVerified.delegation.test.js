'use strict';
// tests/requireCustomerVerified.delegation.test.js
const { makeRequireCustomerVerified } = require('../middleware/requireCustomerVerified');

function run(mw, { userId, support, isVerified = false }) {
  const req = { method: 'POST', originalUrl: '/api/admin/workforce/expenses/204/approve', body: { userId }, session: { support } };
  const res = { status(s) { this.statusCode = s; return { json: (b) => { this.body = b; } }; } };
  let next = false;
  mw(req, res, () => { next = true; });
  return { next, statusCode: res.statusCode, body: res.body };
}

describe('requireCustomerVerified with the ceremony token', () => {
  const recordAudit = jest.fn();
  const make = (live) => makeRequireCustomerVerified({
    isCustomerVerified: () => false,
    recordAudit,
    liveSupportSession: live,
  });

  it('passes when the ceremony session is live for THIS customer', () => {
    const live = jest.fn(() => ({ subjectToken: 't', verifiedUntil: Date.now() + 1000 }));
    const r = run(make(live), { userId: '5', support: {} });
    expect(r.next).toBe(true);
    expect(live).toHaveBeenCalledWith(expect.anything(), '5');
  });

  it('403s customer_not_verified when no live ceremony session exists', () => {
    const r = run(make(() => null), { userId: '5', support: null });
    expect(r.next).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
    expect(r.body.tokenChain.map((e) => e.id)).toEqual(['operator-session', 'operator-verification', 'operator-audit']);
  });

  it('403s when the ceremony session belongs to a DIFFERENT customer', () => {
    const live = jest.fn(() => null); // liveSupportSession already mismatches by id
    const r = run(make(live), { userId: '7', support: { customerId: '5' } });
    expect(r.next).toBe(false);
    expect(r.statusCode).toBe(403);
  });
});
