// /session-lab mock: the PingOne user session as DaVinci's Return Success Response and Check Session
// nodes treat it. Pure and clock-driven (minutes) so a page can advance time without waiting.
// Sourced: one session; each method has its own last-sign-on time; a Return Success Response slides
// the idle window and refreshes the methods it reports; Check Session wants one method, signed on
// within N minutes, before idle expiry. UNVERIFIED: whether the same holds for SSO through an app.
export const METHODS = ['pwd', 'mfa', 'otp', 'sms', 'rba', 'fido', 'pwdless'];
export const DEFAULT_IDLE_MIN = 43200; // inferred minutes (30 days)

export const initial = () => ({ now: 0, session: null, log: [] });

const note = (s, text) => ({ ...s, log: [...s.log, { at: s.now, text }].slice(-12) });
const known = (methods) => [...new Set(methods)].filter((m) => METHODS.includes(m));

export function isLive(s) {
  const x = s.session;
  return !!x && s.now < x.activeAt + x.idleMin;
}

// Return Success Response: with no session it creates one; with one it refreshes the reported methods.
// Idle Timeout is a field on this node, so a shorter value arrives here and not as a separate setting.
// An empty list moves nothing (a routing flow), and cannot create a session.
export function report(s, methods, idleMin = null) {
  const list = known(methods);
  if (!list.length) return note(s, 'Reported no methods: nothing moved.');
  const base = isLive(s) ? s.session : { authenticators: {}, createdAt: s.now, idleMin: DEFAULT_IDLE_MIN };
  const authenticators = { ...base.authenticators };
  list.forEach((m) => { authenticators[m] = s.now; });
  const created = base !== s.session;
  return note({ ...s, session: { ...base, authenticators, activeAt: s.now, idleMin: idleMin ?? base.idleMin } },
    `${created ? 'New session. ' : ''}Reported ${list.join(' + ')}${idleMin ? `, idle timeout ${idleMin} min` : ''}: no user challenge needed to record a method.`);
}

export const revoke = (s) => note({ ...s, session: null }, 'Session deleted.');
export const advance = (s, minutes) => note({ ...s, now: s.now + minutes }, `Time moved ${minutes} min.`);

// Check Session does not slide anything.
export function check(s, { method = null, withinMin = 480 } = {}) {
  if (!isLive(s)) return { ok: false, reason: s.session ? 'idle timeout passed' : 'no session' };
  const a = s.session.authenticators;
  const times = method ? (a[method] != null ? [a[method]] : []) : Object.values(a);
  if (!times.length) return { ok: false, reason: `${method} never reported` };
  if (s.now - Math.max(...times) > withinMin) return { ok: false, reason: `last sign-on older than ${withinMin} min` };
  return { ok: true, reason: 'method present, recent enough, session not idle-expired' };
}
