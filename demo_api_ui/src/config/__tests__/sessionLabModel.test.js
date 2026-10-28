import { initial, report, revoke, advance, check, isLive, DEFAULT_IDLE_MIN } from '../sessionLabModel';

const signed = (methods = ['pwd']) => report(initial(), methods);

describe('sessionLabModel', () => {
  it('creates one session with a per-method time', () => {
    const s = advance(report(signed(['pwd']), ['mfa']), 0);
    expect(Object.keys(s.session.authenticators).sort()).toEqual(['mfa', 'pwd']);
  });
  it('an empty or unknown report moves nothing and cannot create a session', () => {
    expect(report(initial(), []).session).toBeNull();
    expect(report(initial(), ['nope']).session).toBeNull();
    const s = advance(signed(), 10);
    expect(report(s, []).session).toEqual(s.session);
  });
  it('reporting a method that never ran records it with no challenge (sticky SSO)', () => {
    const s = report(advance(signed(['pwd']), 600), ['mfa']);
    expect(check(s, { method: 'mfa', withinMin: 60 }).ok).toBe(true);
  });
  it('check wants the method, recent enough', () => {
    const s = advance(signed(['pwd']), 481);
    expect(check(s, { method: 'pwd' }).ok).toBe(false);
    expect(check(advance(signed(['pwd']), 480), { method: 'pwd' }).ok).toBe(true);
    expect(check(signed(['pwd']), { method: 'mfa' }).reason).toMatch(/never reported/);
  });
  it('a report slides the idle window; a check does not', () => {
    const s0 = report(signed(['pwd']), ['pwd'], 10);
    const slid = report(advance(s0, 8), ['pwd']);
    expect(isLive(advance(slid, 8))).toBe(true);
    check(advance(s0, 8));
    expect(isLive(advance(s0, 10))).toBe(false);
  });
  it('idle expiry fails the check and a new report starts a fresh session', () => {
    const s = advance(report(signed(), ['pwd'], 5), 5);
    expect(check(s).reason).toBe('idle timeout passed');
    expect(report(s, ['pwd']).session.createdAt).toBe(5);
  });
  it('revoke deletes it; default idle is 30 days in minutes', () => {
    expect(check(revoke(signed())).reason).toBe('no session');
    expect(signed().session.idleMin).toBe(DEFAULT_IDLE_MIN);
  });
});
