jest.mock('../services/tokenIntrospectionService', () => ({
  validateToken: jest.fn().mockResolvedValue({ valid: true, sub: 'u1' }),
}));
jest.mock('../services/tokenChainService', () => ({ trackTokenEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/apiCallTrackerService', () => ({ trackToken: jest.fn() }));
jest.mock('../services/archEventEmitter', () => jest.fn());

const { establishAdminSession } = require('../services/adminSessionService');

function makeReq({ regenErr = null, saveErr = null } = {}) {
  const session = {
    id: 'old',
    regenerate(cb) {
      if (regenErr) return cb(regenErr);
      for (const k of Object.keys(session)) if (typeof session[k] !== 'function') delete session[k];
      session.id = 'new';
      cb();
    },
    save(cb) { cb(saveErr); },
  };
  return { session };
}

const opts = (over = {}) => ({
  tokenData: { access_token: 'at', id_token: 'idt', refresh_token: 'rt', expires_in: 60, scope: 's' },
  provider: 'pingone',
  clientType: 'admin',
  user: { id: 'u1', username: 'bob' },
  ...over,
});

test('regenerates session and stores tokens, user, clientType, provider', async () => {
  const req = makeReq();
  const r = await establishAdminSession(req, {}, opts());
  expect(r.ok).toBe(true);
  expect(r.oauthTokens).toMatchObject({ accessToken: 'at', idToken: 'idt', refreshToken: 'rt' });
  expect(req.session).toMatchObject({ id: 'new', clientType: 'admin', oauthProvider: 'pingone' });
  expect(req.session.user.username).toBe('bob');
  expect(req.session.oauthTokens.accessToken).toBe('at');
});

test('regenerate failure returns reason and stores nothing', async () => {
  const req = makeReq({ regenErr: new Error('boom') });
  const r = await establishAdminSession(req, {}, opts());
  expect(r).toMatchObject({ ok: false, reason: 'session_regenerate_failed' });
  expect(req.session.oauthTokens).toBeUndefined();
  expect(req.session.user).toBeUndefined();
});

test('save failure returns session_persist_failed', async () => {
  const r = await establishAdminSession(makeReq({ saveErr: new Error('x') }), {}, opts());
  expect(r).toMatchObject({ ok: false, reason: 'session_persist_failed' });
});

test('onRegenerated runs after regenerate wiped the session, so stamps land on the NEW session', async () => {
  const req = makeReq();
  req.session.preExisting = 'wiped';
  let seen;
  const r = await establishAdminSession(req, {}, opts({
    onRegenerated: (sess) => { seen = { id: sess.id, pre: sess.preExisting, hasTokens: !!sess.oauthTokens }; sess.stamp = 'x'; },
  }));
  expect(r.ok).toBe(true);
  expect(seen).toEqual({ id: 'new', pre: undefined, hasTokens: true });
  expect(req.session.stamp).toBe('x');
});

test('onRegenerated is not called when regenerate fails', async () => {
  const onRegenerated = jest.fn();
  await establishAdminSession(makeReq({ regenErr: new Error('x') }), {}, opts({ onRegenerated }));
  expect(onRegenerated).not.toHaveBeenCalled();
});
