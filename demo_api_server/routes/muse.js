'use strict';
/**
 * routes/muse.js — the real "Muse" personal-agent page (/personal-agent/muse). Mounted at /api/muse.
 *
 * A parallel route file: it does not touch the app's own sign-in or session code. The PingOne return is a
 * cross-site navigation, so GET /callback never relies on the session cookie; a one-time `state` value (10 min)
 * ties the return to the session that started it. Tokens live only in `workspaces` below, never in req.session
 * and never in a response.
 */
const express = require('express');
const muse = require('../services/museLive');
const { requireSession } = require('../middleware/auth');

const PENDING_MS = 10 * 60 * 1000;
const MAX_WORKSPACES = 200;
const PAGE_PATH = '/personal-agent/muse';
const emptyAuth = () => ({ client: null, token: null, claims: null, steps: [], error: null, ask: null, answer: null, discovery: null, lane: 'gateway' });

function createMuseRouter({ fetchImpl = (...a) => fetch(...a), getConfig = muse.museConfig, now = Date.now } = {}) {
  const router = express.Router();
  const workspaces = new Map(); // session id -> { liveAuth, at }
  const pending = new Map(); // one-time state -> { wsId, verifier, resource, lane, at }

  const workspace = (req) => {
    let w = workspaces.get(req.sessionID);
    if (!w) {
      if (workspaces.size >= MAX_WORKSPACES) workspaces.delete(workspaces.keys().next().value);
      w = emptyAuth();
      workspaces.set(req.sessionID, w);
    }
    return w;
  };
  const addStep = (w, step) => { if (step) w.steps = [...w.steps.filter((x) => x.n !== step.n), step].sort((a, b) => a.n - b.n); };
  const failed = (e) => ({ error: 'Muse could not reach the gateway', detail: String(e?.name ?? 'error').slice(0, 40) });
  const laneOf = (v) => (v === 'privilege' ? 'privilege' : 'gateway');

  // What the page sees: claims, steps and the answer. Never a token.
  const view = (w, cfg) => ({
    configured: cfg.configured,
    lane: w.lane,
    laneAvailable: cfg.laneAvailable,
    origin: cfg.origin,
    userLogin: Boolean(cfg.userClientId),
    user: w.user ?? null,
    assistants: cfg.configured ? (cfg.assistants ?? []).map(({ key, name }) => ({ key, name })) : [],
    assistant: w.assistant ?? null,
    liveAuth: {
      registered: Boolean(w.client), signedIn: Boolean(w.token), claims: w.claims, error: w.error,
      ask: w.ask, answer: w.answer, steps: [...(w.discovery?.steps ?? []).filter((s) => !w.steps.some((x) => x.n === s.n)), ...w.steps].sort((a, b) => a.n - b.n),
      stopped: w.discovery?.stopped ?? null,
    },
  });

  const runAsk = async (w, cfg) => {
    const steps = await muse.callGateway(cfg, fetchImpl, w.token, { tool: w.ask?.tool ?? 'loyalty_balance' });
    for (const s of steps) addStep(w, s);
    w.answer = muse.answerFrom(steps);
  };

  router.get('/state', requireSession, (req, res) => {
    const w = workspace(req);
    res.set('Cache-Control', 'no-store').json(view(w, getConfig(w.lane)));
  });

  // The user asks first. With no token Muse calls the gateway, gets the 401 and shows it; PingOne comes after.
  router.post('/ask', express.json(), requireSession, async (req, res) => {
    const w = workspace(req);
    const lane = laneOf(req.body?.lane);
    const cfg = getConfig(lane);
    if (!cfg.configured) return res.status(503).json({ error: 'Muse is not configured', need_config: ['pingone_muse_client_secret'] });
    if (!cfg.laneAvailable) return res.status(409).json({ error: 'That lane has no gateway URL configured (MUSE_PRIVILEGE_URL).' });
    const prompt = String(req.body?.prompt ?? '').slice(0, 200);
    if (!/point|mile|balance|loyal/i.test(prompt)) return res.status(400).json({ error: 'Muse can answer one thing so far: your airline points.' });
    if (w.lane !== lane) Object.assign(w, emptyAuth(), { lane });
    w.ask = { prompt, tool: 'loyalty_balance' }; w.answer = null; w.error = null;
    try {
      if (w.token) { await runAsk(w, cfg); return res.json({ state: 'done' }); }
      w.discovery = await muse.liveDiscovery(cfg, fetchImpl);
      return res.json({ state: 'auth_required' });
    } catch (e) { return res.status(502).json(failed(e)); }
  });

  // Step 4. PingOne already has Muse's app, so there is nothing to register: this only records the app.
  router.post('/register', requireSession, (req, res) => {
    const w = workspace(req);
    const cfg = getConfig(w.lane);
    if (!cfg.configured) return res.status(503).json({ error: 'Muse is not configured', need_config: ['pingone_muse_client_secret'] });
    w.client = { clientId: cfg.idp.clientId, redirectUri: cfg.redirectUri };
    w.error = null;
    addStep(w, { n: 4, title: "Use Muse's PingOne app", request: { method: 'GET', url: cfg.idp.authorizeEndpoint }, note: 'No registration. Muse is a PingOne app; PingOne handles login, Protect, MFA and consent after the redirect.' });
    return res.json({ registered: true, error: null });
  });

  // Step 5. Returns the authorize URL; the page navigates there. Nothing authenticated has been sent yet.
  router.post('/signin', express.json(), requireSession, (req, res) => {
    const w = workspace(req);
    const cfg = getConfig(w.lane);
    if (!cfg.configured) return res.status(503).json({ error: 'Muse is not configured', need_config: ['pingone_muse_client_secret'] });
    if (!w.client) return res.status(409).json({ error: 'register Muse first' });
    const r = muse.startSignIn(cfg, { mfa: req.body?.mfa !== 'off' });
    for (const [k, v] of pending) if (now() - v.at > PENDING_MS) pending.delete(k);
    pending.set(r.state, { wsId: req.sessionID, verifier: r.verifier, resource: r.resource, lane: w.lane, at: now() });
    addStep(w, { n: 5, title: 'Send the user to sign in', request: { method: 'GET', url: r.url.replace(/code_challenge=[^&]+/, 'code_challenge=(sent)') }, note: 'The browser leaves Muse for PingOne. PKCE S256, prompt=login so PingOne always asks the user to sign in.' });
    return res.json({ url: r.url });
  });

  // Just a user: Sam signs in as himself through the user-only PingOne app. No agent screen, no consent, no exchange.
  router.post('/user-signin', express.json(), requireSession, (req, res) => {
    const w = workspace(req);
    const lane = laneOf(req.body?.lane ?? w.lane);
    const cfg = getConfig(lane);
    if (!cfg.configured) return res.status(503).json({ error: 'Muse is not configured', need_config: ['pingone_muse_client_secret'] });
    if (!cfg.userClientId) return res.status(409).json({ error: 'The user-only sign-in is not configured (MUSE_USER_CLIENT_ID).' });
    if (!cfg.laneAvailable) return res.status(409).json({ error: 'That lane has no gateway URL configured.' });
    const r = muse.startUserSignIn(cfg, { mfa: req.body?.mfa !== 'off' });
    for (const [k, v] of pending) if (now() - v.at > PENDING_MS) pending.delete(k);
    pending.set(r.state, { wsId: req.sessionID, verifier: r.verifier, lane, kind: 'user', at: now() });
    w.user = null;
    return res.json({ url: r.url });
  });

  // Connect from your assistant: the customer clicked Connect in ChatGPT's, Claude's or Meta AI's directory. The sign-in uses that
  // assistant's own PingOne app, so Protect and the screens name it; then Muse's server acts for the user with that app and asks for the points.
  router.post('/assistant-signin', express.json(), requireSession, (req, res) => {
    const w = workspace(req);
    const lane = laneOf(req.body?.lane ?? w.lane);
    const cfg = getConfig(lane);
    if (!cfg.configured) return res.status(503).json({ error: 'Muse is not configured', need_config: ['pingone_muse_client_secret'] });
    if (!cfg.laneAvailable) return res.status(409).json({ error: 'That lane has no gateway URL configured.' });
    const acfg = muse.assistantConfig(cfg, String(req.body?.assistant ?? ''));
    if (!acfg) return res.status(409).json({ error: 'That assistant is not configured.' });
    const r = muse.startSignIn(acfg, { mfa: req.body?.mfa !== 'off', connector: true });
    for (const [k, v] of pending) if (now() - v.at > PENDING_MS) pending.delete(k);
    pending.set(r.state, { wsId: req.sessionID, verifier: r.verifier, resource: r.resource, lane, kind: 'assistant', assistant: acfg.assistant.key, at: now() });
    w.assistant = null;
    return res.json({ url: r.url });
  });

  // Step 6. PingOne sends the browser back here with a code. No session cookie is assumed: the state is the key.
  router.get('/callback', async (req, res) => {
    const state = String(req.query.state ?? '');
    const p = pending.get(state);
    pending.delete(state); // one-time: a replayed state finds nothing
    const w = p && now() - p.at <= PENDING_MS ? workspaces.get(p.wsId) : null;
    if (!w) return res.status(400).type('text').send('Unknown or expired sign-in. Start again from Muse.');
    const back = () => res.set('Cache-Control', 'no-store').redirect(302, PAGE_PATH);
    if (req.query.error) { w.error = `Sign-in was refused: ${String(req.query.error).slice(0, 60)}.`; return back(); }
    if (p.kind === 'assistant') {
      const acfg = muse.assistantConfig(getConfig(p.lane), p.assistant);
      w.assistant = { ...(acfg?.assistant ?? { key: p.assistant, name: p.assistant }), claims: null, answer: null, error: null, lane: p.lane };
      try {
        if (!acfg) throw new Error('assistant gone');
        const r = await muse.exchangeCode(acfg, fetchImpl, { code: String(req.query.code ?? ''), verifier: p.verifier, resource: p.resource });
        if (!r.token) { w.assistant.error = r.error ?? 'PingOne did not issue a token.'; return back(); }
        const d = await muse.delegate(acfg, fetchImpl, r.token);
        if (!d.token) { w.assistant.error = d.error ?? 'The token exchange was refused.'; return back(); }
        w.assistant.claims = d.claims ?? null;
        const steps = await muse.callGateway(acfg, fetchImpl, d.token, { tool: 'loyalty_balance' });
        w.assistant.answer = muse.answerFrom(steps);
        if (!w.assistant.answer) w.assistant.error = `The gateway did not answer (${steps.filter((x) => x.response).slice(-1)[0]?.response?.status ?? 'no answer'}).`;
      } catch (e) { w.assistant.error = failed(e).error; }
      return back();
    }
    if (p.kind === 'user') {
      try {
        const cfg = getConfig(p.lane);
        const r = await muse.exchangeUserCode(cfg, fetchImpl, { code: String(req.query.code ?? ''), verifier: p.verifier });
        w.user = { claims: r.claims ?? null, steps: [r.step].filter(Boolean), error: r.error ?? null, denied: null, lane: p.lane };
        if (r.token) {
          // Sam's own token straight to the gateway: no act claim, no exchange. The token is dropped right after this call.
          const steps = await muse.callGateway(cfg, fetchImpl, r.token, { tool: 'loyalty_balance' });
          w.user.steps.push(...steps);
          w.user.denied = steps.some((x) => x.response && x.response.status >= 400);
        }
      } catch (e) { w.user = { claims: null, steps: [], error: failed(e).error, denied: null }; }
      return back();
    }
    try {
      const cfg = getConfig(p.lane);
      const r = await muse.exchangeCode(cfg, fetchImpl, { code: String(req.query.code ?? ''), verifier: p.verifier, resource: p.resource });
      addStep(w, r.step);
      w.error = r.error ?? null;
      if (r.token) {
        const d = await muse.delegate(cfg, fetchImpl, r.token);
        for (const s of d.steps) addStep(w, s);
        w.error = d.error ?? null;
        if (d.token) { w.token = d.token; w.claims = d.claims ?? { opaque: true }; }
      }
      // The retry: now that Muse has a token, it finishes the request the user made before signing in.
      if (w.token && w.ask) await runAsk(w, cfg);
    } catch (e) { w.error = failed(e).error; }
    return back();
  });

  router.post('/call', requireSession, async (req, res) => {
    const w = workspace(req);
    if (!w.token) return res.status(409).json({ error: 'sign in first' });
    try { await runAsk(w, getConfig(w.lane)); return res.json({ ok: true }); } catch (e) { return res.status(502).json(failed(e)); }
  });

  router.post('/reset', requireSession, (req, res) => {
    workspaces.delete(req.sessionID);
    for (const [k, v] of pending) if (v.wsId === req.sessionID) pending.delete(k);
    res.json({ reset: true });
  });

  return router;
}

module.exports = { createMuseRouter, router: createMuseRouter() };
