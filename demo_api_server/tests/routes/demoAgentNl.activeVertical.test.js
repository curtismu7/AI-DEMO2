'use strict';
/**
 * POST /api/demo-agent/nl pinned ANY slug-shaped `vertical` onto
 * req.session.active_vertical with no membership and no HIDDEN_IDS check,
 * walking around the 403/404 that POST /api/vertical-manifest/active enforces.
 * That is how a hidden, deprecated vertical became a session's active one — the
 * precondition for the whole banking-coercion class (#1214, #1228, #1232, #1250).
 *
 * Live reproduction before the fix, both real routes, same ids:
 *
 *   id=pizza          POST /vertical-manifest/active -> 404 {"error":"unknown id"}
 *                     POST /demo-agent/nl            -> 200 session.active_vertical="pizza"
 *   id=admin-console  POST /vertical-manifest/active -> 403 {"error":"cannot activate hidden vertical"}
 *                     POST /demo-agent/nl            -> 200 session.active_vertical="admin-console"
 *
 * The fix declines the PIN, not the request. resolveVerticalRouting already
 * prefers the explicit request param over the session, so this turn routes
 * exactly as before; only the persistence to later requests that omit the param
 * is refused. That matters because the `vertical` body param is the documented
 * mechanism for hidden verticals — OAuth Academy pins `oauth-teaching`
 * per-request specifically to avoid switching the session-wide active vertical
 * (see demo_api_ui/src/components/OAuthAcademyPage.jsx:12-17) — and because /nl
 * is an anonymous-friendly marketing path where a 400 would be a hard failure.
 */

jest.mock('../../services/geminiNlIntent', () => ({
  parseNaturalLanguage: jest.fn(async () => ({ source: 'heuristic', result: { kind: 'none' } })),
  EDU: {},
}));
jest.mock('../../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));
jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({
  saveMessage: jest.fn(),
  getHistory: jest.fn(() => []),
}));

const request = require('supertest');
const express = require('express');

function nlApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/demo-agent', require('../../routes/demoAgentNl'));
  return app;
}

function manifestApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    req.user = { id: 'u1', role: 'customer' };
    next();
  });
  app.use('/api/vertical-manifest', require('../../routes/verticalManifest'));
  return app;
}

const newSession = () => ({ save: (cb) => cb && cb() });

/** POST /nl with `vertical`, returning the id it pinned (or undefined). */
async function pinnedBy(vertical) {
  require('../../services/verticalManifest').verticalManifest.init();
  const session = newSession();
  const res = await request(nlApp(session))
    .post('/api/demo-agent/nl')
    .send({ message: 'hello', vertical });
  return { status: res.status, pinned: session.active_vertical };
}

/** POST /vertical-manifest/active with the same id. */
async function activateStatus(id) {
  require('../../services/verticalManifest').verticalManifest.init();
  const res = await request(manifestApp(newSession()))
    .post('/api/vertical-manifest/active')
    .send({ id });
  return res.status;
}

describe('POST /api/demo-agent/nl — the `vertical` param may not activate what the switcher refuses', () => {
  it('still pins a real, activatable vertical (unchanged behaviour)', async () => {
    expect(await activateStatus('healthcare')).toBe(204);
    expect(await pinnedBy('healthcare')).toEqual({ status: 200, pinned: 'healthcare' });
  });

  it('does not pin an unknown slug — the switcher 404s it', async () => {
    expect(await activateStatus('pizza')).toBe(404);
    const { status, pinned } = await pinnedBy('pizza');
    expect(pinned).toBeUndefined();
    expect(status).toBe(200); // the request itself is not rejected
  });

  it('does not pin a hidden, deprecated vertical — the switcher 403s it', async () => {
    expect(await activateStatus('admin-console')).toBe(403);
    const { status, pinned } = await pinnedBy('admin-console');
    expect(pinned).toBeUndefined();
    expect(status).toBe(200);
  });

  // oauth-teaching is hidden from the switcher but is reached legitimately via
  // the per-request `vertical` param (OAuth Academy). The turn must still work;
  // only the session-wide pin is refused — which is what that page already wants.
  it('does not pin oauth-teaching, but still answers the turn', async () => {
    expect(await activateStatus('oauth-teaching')).toBe(403);
    const { status, pinned } = await pinnedBy('oauth-teaching');
    expect(pinned).toBeUndefined();
    expect(status).toBe(200);
    const { parseNaturalLanguage } = require('../../services/geminiNlIntent');
    // The explicit param still drives THIS turn's routing.
    expect(parseNaturalLanguage).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ vertical: 'oauth-teaching' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('a malformed slug is still a 400 (unchanged)', async () => {
    const res = await request(nlApp(newSession()))
      .post('/api/demo-agent/nl')
      .send({ message: 'hello', vertical: 'Bad_ID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_vertical');
  });

  // The anti-divergence pin: both doors must answer from ONE rule.
  it('pins exactly the ids the switcher would activate', async () => {
    for (const id of ['banking', 'healthcare', 'airlines', 'pizza', 'admin-console', 'oauth-teaching']) {
      const activatable = (await activateStatus(id)) === 204;
      const { pinned } = await pinnedBy(id);
      expect({ id, pinned: pinned === id }).toEqual({ id, pinned: activatable });
    }
  });
});

/**
 * recordRunFromNl filed the run — and the conversation history keyed on the same
 * id — under `vertical || resolver.activeIdFor(req) || 'banking'`. activeIdFor
 * falls back to the PROCESS-GLOBAL, which resolveVerticalRouting deliberately
 * does not, because any other session's POST /verticals/active mutates it. So an
 * unpinned session's run was filed under whatever vertical another session last
 * selected, and otherwise under banking outright.
 */
describe('POST /api/demo-agent/nl — a run is filed under the vertical it executed in', () => {
  /**
   * Drive one turn that produces an action, and report the vertical it was filed
   * under. Everything is require()'d here, not at file scope: setup.js resets the
   * module registry after each test, so a file-scope handle is a different
   * instance from the one the route resolves and its mock records nothing.
   */
  async function filedVertical({ vertical, sessionPin, processGlobal }) {
    const { verticalManifest } = require('../../services/verticalManifest');
    const reportStore = require('../../services/lmdb/reportStore.lmdb');
    const { parseNaturalLanguage } = require('../../services/geminiNlIntent');
    verticalManifest.init();
    parseNaturalLanguage.mockResolvedValue({
      source: 'heuristic',
      result: { kind: 'banking', banking: { action: 'get_my_accounts' } },
    });
    if (processGlobal) verticalManifest.resolver.setActive(processGlobal);
    const session = { save: (cb) => cb && cb(), user: { oauthId: 'u1' } };
    if (sessionPin) session.active_vertical = sessionPin;
    await request(nlApp(session))
      .post('/api/demo-agent/nl')
      .send({ message: 'show my accounts', ...(vertical ? { vertical } : {}) });
    const filed = reportStore.saveRun.mock.calls[0]?.[0]?.vertical;
    verticalManifest.resolver.setActive('banking');
    return filed;
  }

  it('uses this session\'s pin, not the process-global another session set', async () => {
    expect(await filedVertical({ sessionPin: 'healthcare', processGlobal: 'retail' })).toBe('healthcare');
  });

  it('does not inherit the process-global for an unpinned session', async () => {
    expect(await filedVertical({ processGlobal: 'retail' })).toBe('banking');
  });

  it('an explicit param still wins', async () => {
    expect(await filedVertical({ vertical: 'airlines', sessionPin: 'healthcare' })).toBe('airlines');
  });
});
