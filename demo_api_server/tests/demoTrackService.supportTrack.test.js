'use strict';
// tests/demoTrackService.supportTrack.test.js
const svc = require('../services/demoTrackService');

describe('support track isolation + observation', () => {
  beforeEach(() => svc._resetForTests());

  it('support events fill support slots only; main calls never cross', () => {
    const session = 'sess-support-1';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'token-issued' }, session);
    let { run } = svc.getState(session, 'support');
    expect(run.slots['support-verify:green'].verdict).toBe('PERMIT');
    // a main-track tool call must not touch the support track
    svc.observeToolCall({ toolName: 'transfer_funds', success: true }, session);
    ({ run } = svc.getState(session, 'support'));
    expect(run.slots['support-exchange:green']).toBeUndefined();
    // main track unaffected by support events
    svc.observeSupportEvent({ kind: 'exchange', ok: true, actSub: 'admin-cid' }, session);
    const main = svc.getState(session, 'main');
    expect(main.run.slots['delegated-access:green']).toBeUndefined();
  });

  it('wrong OTP fills the red slot; a later correct OTP fills green', () => {
    const session = 'sess-support-2';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'otp-invalid' }, session);
    let { run } = svc.getState(session, 'support');
    expect(run.slots['support-verify:red'].verdict).toBe('BLOCKED');
    svc.observeSupportEvent({ kind: 'token-issued' }, session);
    ({ run } = svc.getState(session, 'support'));
    expect(run.slots['support-verify:green'].verdict).toBe('PERMIT');
  });

  it('write-denied fills the write red slot with the 403 story', () => {
    const session = 'sess-support-3';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'write-denied' }, session);
    const { run } = svc.getState(session, 'support');
    expect(run.slots['support-write:red'].verdict).toBe('BLOCKED');
  });
});
