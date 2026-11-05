'use strict';

const { startCiba, pollCiba, emailDecide, emailStatus, emailChannelEnabled } = require('../services/pfAiAgentCibaService');

const storeWith = (flag) => ({ getEffective: (key) => (String(key).toLowerCase() === 'pf_ai_ciba_email_enabled' ? flag : '') });
const noFetch = jest.fn();
const signedIn = () => ({ session: { user: { username: 'demouser', email: 'alice@example.com' } } });
const signedInNoEmail = () => ({ session: { user: { username: 'demouser' } } });

describe('CIBA email channel', () => {
  beforeEach(() => noFetch.mockClear());

  it('starts without calling PingFederate and waits for the emailed link', async () => {
    const req = signedIn();
    const view = await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
    expect(view).toMatchObject({ state: 'pending', loginHint: 'alice@example.com' });
    expect((await pollCiba(req, { store: storeWith('true'), fetchImpl: noFetch })).state).toBe('pending');
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('the emailed link decides approve and deny, single use', async () => {
    for (const [decision, state] of [['approve', 'approved'], ['deny', 'denied']]) {
      const req = signedIn();
      await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
      const token = req.session.pfAiAgent.cibaPending.emailToken;
      expect(emailStatus(token).state).toBe('waiting');
      expect(emailDecide({ token, decision, store: storeWith('true') })).toMatchObject({ state: 'received', decision: state });
      expect((await pollCiba(req, { store: storeWith('true'), fetchImpl: noFetch })).state).toBe(state);
      // The token is one-time: once the poll consumed it, a second decide is refused.
      expect(() => emailDecide({ token, decision, store: storeWith('true') })).toThrow(/no longer valid/);
      expect(req.session.pfAiAgent.cibaPending).toBeUndefined();
    }
  });

  it('prefetch of the link status page does not decide anything', async () => {
    const req = signedIn();
    await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
    const token = req.session.pfAiAgent.cibaPending.emailToken;
    expect(emailStatus(token)).toMatchObject({ state: 'waiting', decision: null });
    expect((await pollCiba(req, { store: storeWith('true'), fetchImpl: noFetch })).state).toBe('pending');
  });

  it('rejects an invalid, used or unknown token', async () => {
    expect(() => emailDecide({ token: 'nope', decision: 'approve', store: storeWith('true') })).toThrow(/no longer valid/);
    expect(() => emailDecide({ token: 'nope', decision: 'maybe', store: storeWith('true') })).toThrow(/approve or deny/);
    expect(emailStatus('nope').state).toBe('invalid');
  });

  it('requires the signed-in user email', async () => {
    await expect(startCiba(signedInNoEmail(), { store: storeWith('true'), fetchImpl: noFetch }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_EMAIL_REQUIRED' });
  });

  it('takes precedence over the mock phone and is inert when off', async () => {
    const req = signedIn();
    await startCiba(req, { store: storeWith('true'), fetchImpl: noFetch });
    expect(req.session.pfAiAgent.cibaPending.emailChannel).toBe(true);
    await expect(startCiba(signedIn(), { store: storeWith(''), fetchImpl: noFetch }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_CONFIGURED' });
  });

  it('is inert in production even with the flag on', async () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(emailChannelEnabled(storeWith('true'))).toBe(false);
      await expect(startCiba(signedIn(), { store: storeWith('true'), fetchImpl: noFetch }))
        .rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_CONFIGURED' });
    } finally {
      process.env.NODE_ENV = was;
    }
  });

  it('a real SMTP round trip delivers the approval email', async () => {
    const sink = require('../services/cibaEmailSmtp');
    sink.startSink();
    try {
      const info = await sink.sendApprovalEmail({
        to: 'alice@example.com', subject: 'CIBA approval', text: 'Open the one-time link',
      });
      expect(info.messageId).toBeTruthy();
      expect(sink.sinkPort()).toBeGreaterThan(0);
    } finally {
      sink.stopSink();
    }
  });
});
