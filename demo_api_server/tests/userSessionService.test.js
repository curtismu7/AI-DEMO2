jest.mock('../services/tokenIntrospectionService', () => ({
  introspectAtLogin: jest.fn().mockResolvedValue({ active: true }),
}));
jest.mock('../services/loginFlowTraceService', () => ({ addStep: jest.fn() }));
jest.mock('../services/enterpriseMcpPolicyService', () => ({ isEnabled: () => false }));

const { establishUserSession } = require('../services/userSessionService');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `h.${b64(claims)}.s`;

function makeReq({ regenErr = null, saveErr = null } = {}) {
  const session = {
    id: 'old',
    pendingAgentIntent: 'x',
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
  tokenData: { access_token: jwt({ may_act: { sub: 'agent' } }), id_token: 'idt', refresh_token: 'rt', expires_in: 60, scope: 's' },
  idTokenClaims: { sub: 'u1', acr: 'Multi_Factor' },
  provider: 'pingone',
  clientType: 'user',
  user: { id: 'u1', username: 'bob' },
  loginTraceId: 't1',
  ...over,
});

test('regenerates session and stores tokens, user, consentAcr, mayAct', async () => {
  const req = makeReq();
  const r = await establishUserSession(req, {}, opts());
  expect(r.ok).toBe(true);
  const s = req.session;
  expect(s.id).toBe('new');
  expect(s.oauthType).toBe('user');
  expect(s.oauthProvider).toBe('pingone');
  expect(s.clientType).toBe('user');
  expect(s.user.username).toBe('bob');
  expect(s.oauthTokens).toMatchObject({ idToken: 'idt', refreshToken: 'rt', subjectSub: 'u1' });
  expect(s.consentAcr).toBe('Multi_Factor');
  expect(s.mayAct).toEqual({ sub: 'agent' });
  expect(s.loginIntrospection).toEqual({ active: true });
  expect(s.pendingAgentIntent).toBeUndefined();
});

test('regenerate failure returns reason and stores nothing', async () => {
  const req = makeReq({ regenErr: new Error('boom') });
  const r = await establishUserSession(req, {}, opts());
  expect(r).toEqual({ ok: false, reason: 'session_regenerate_failed' });
  expect(req.session.oauthTokens).toBeUndefined();
  expect(req.session.user).toBeUndefined();
});

test('save failure returns session_persist_failed', async () => {
  const r = await establishUserSession(makeReq({ saveErr: new Error('x') }), {}, opts());
  expect(r).toEqual({ ok: false, reason: 'session_persist_failed' });
});
