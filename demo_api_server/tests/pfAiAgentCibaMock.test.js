'use strict';

const { startCiba, pollCiba, mockDecideCiba } = require('../services/pfAiAgentCibaService');

const storeWith = (flag) => ({ getEffective: (key) => (String(key).toLowerCase() === 'pf_ai_ciba_mock_enabled' ? flag : '') });
const noFetch = jest.fn();
const signedIn = () => ({ session: { user: { username: 'demouser' } } });

describe('CIBA mock phone', () => {
  beforeEach(() => noFetch.mockClear());

  it('starts without calling PingFederate and waits for a decision', async () => {
    const req = signedIn();
    const view = await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
    expect(view).toMatchObject({ state: 'pending', loginHint: 'demouser' });
    expect((await pollCiba(req, { store: storeWith('true'), fetchImpl: noFetch })).state).toBe('pending');
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('approve and deny finish the request', async () => {
    for (const [decision, state] of [['approve', 'approved'], ['deny', 'denied']]) {
      const req = signedIn();
      await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
      expect(mockDecideCiba(req, decision, { store: storeWith('true') })).toMatchObject({ state, loginHint: 'demouser' });
      expect(req.session.pfAiAgent.cibaPending).toBeUndefined();
    }
  });

  it('is inert when the flag is off', async () => {
    const req = signedIn();
    await expect(startCiba(req, { store: storeWith(''), fetchImpl: noFetch })).rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_CONFIGURED' });
    expect(() => mockDecideCiba(req, 'approve', { store: storeWith('') })).toThrow(/not enabled/);
  });

  it('is inert in production even with the flag on', async () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(startCiba(signedIn(), { store: storeWith('true'), fetchImpl: noFetch })).rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_CONFIGURED' });
      expect(() => mockDecideCiba(signedIn(), 'approve', { store: storeWith('true') })).toThrow(/not enabled/);
    } finally {
      process.env.NODE_ENV = was;
    }
  });

  it('rejects an unknown decision and a decision with nothing pending', async () => {
    const req = signedIn();
    expect(() => mockDecideCiba(req, 'approve', { store: storeWith('true') })).toThrow(/No mock approval/);
    await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
    expect(() => mockDecideCiba(req, 'maybe', { store: storeWith('true') })).toThrow(/approve or deny/);
  });
});
