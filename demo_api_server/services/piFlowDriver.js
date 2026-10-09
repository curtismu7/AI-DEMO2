'use strict';
// Shared pi.flow driver for the BFF's redirect-free sign-in (user + admin).
// Extracted verbatim from routes/oauthUser.js so the admin router can drive the
// same flow: /login?pi_flow=1 opens the flow, POST /pi-flow/credentials drives
// it, and a COMPLETED flow hands the browser to the UNCHANGED /callback with
// ?code&state — so PKCE, nonce and session creation all stay where they are.
// Anything a step can't finish (MFA, a policy screen) returns {fallback:true}
// and the SPA starts the ordinary redirect login instead.
const configStore = require('./configStore');

const PI_FLOW_TIMEOUT_MS = 10_000;

// PingOne binds the flow to an ST session cookie that changes as the flow
// advances: the password step issues a new one, and /as/resume rejects the flow
// ("Session token cookie value does not match") unless it is replayed. Keep a
// name->value jar in the BFF session and merge every response's Set-Cookie.
function mergePiFlowCookies(jar, response) {
  const next = { ...jar };
  for (const c of response.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) next[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  return next;
}
const piFlowCookieHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => `${k}=${v}`).join('; ');

// pi.flow runs against whichever provider is selected. PingOne drives /flows/{id}
// then /as/resume; PingFederate drives /pf-ws/authn/flows/{id} and returns the
// authorization response inline on COMPLETED (no resume step).
const piFlowProvider = () => (configStore.getOAuthProvider?.() === 'pingfederate' ? 'pingfederate' : 'pingone');

// The provider config each router passes: endpoints come from the router's own
// config module (admin vs user), everything else is provider-shared.
function piFlowBase(provider, providerConfig) {
  if (provider === 'pingfederate') {
    const server = String(providerConfig.tokenEndpoint || providerConfig.authorizationEndpoint || '');
    return new URL(server).origin;
  }
  return String(providerConfig.authorizationEndpoint || '').replace(/\/as\/authorize.*$/, '');
}

const piFlowStepUrl = (pending, providerConfig) => (pending.provider === 'pingfederate'
  ? `${piFlowBase(pending.provider, providerConfig)}/pf-ws/authn/flows/${pending.flowId}`
  : `${piFlowBase(pending.provider, providerConfig)}/flows/${pending.flowId}`);

// The flow id goes into a URL path, so only accept the shapes the providers issue.
const PI_FLOW_ID = /^[A-Za-z0-9_-]{6,64}$/;

// providerConfig: config module with authorizationEndpoint/tokenEndpoint getters
// (config/oauthUser.js or config/oauth.js). KNOWN_REDIRECT_ORIGINS is only
// needed by the assertion step; pass it from the caller that has it.
function makePiFlowHandlers({ providerConfig, knownRedirectOrigins }) {
  async function openPiFlow(req, res, authorizeUrl, provider) {
    try {
      let target = authorizeUrl;
      if (provider === 'pingfederate') {
        // Same request, but sent to the server-reachable origin (see piFlowBase).
        const u = new URL(authorizeUrl);
        const base = new URL(piFlowBase(provider, providerConfig));
        u.protocol = base.protocol;
        u.host = base.host;
        target = u.toString();
      }
      const r = await fetch(target, {
        headers: { Accept: provider === 'pingfederate' ? 'application/json' : '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(PI_FLOW_TIMEOUT_MS),
      });
      const flow = await r.json().catch(() => null);
      if (!r.ok || !PI_FLOW_ID.test(String(flow?.id || ''))) {
        console.warn('[oauth/pi-flow] authorize did not open a flow: HTTP %s', r.status);
        return res.status(502).json({ error: 'pi_flow_unavailable' });
      }
      req.session.oauthPiFlow = { flowId: flow.id, provider, startedAt: Date.now(), cookies: mergePiFlowCookies({}, r) };
      // PingFederate binds the flow to the authorize request's login_hint ("Username must
      // match the provided username hint"), so hand it to the SPA to prefill, as the hosted
      // login page does. PingOne does not bind it, so nothing is sent for PingOne.
      const usernameHint = provider === 'pingfederate' ? new URL(authorizeUrl).searchParams.get('login_hint') : null;
      return req.session.save((err) => {
        if (err) return res.status(500).json({ error: 'session_save_failed' });
        return res.json({ flowId: flow.id, status: flow.status, ...(usernameHint ? { usernameHint } : {}) });
      });
    } catch (error) {
      console.warn('[oauth/pi-flow] authorize failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_unavailable' });
    }
  }

  // Posts one step to the open flow with the current cookie jar; returns the
  // parsed body and the updated jar. Never throws on a non-2xx: callers branch on it.
  async function postPiFlowStep(pending, contentType, payload) {
    const pf = pending.provider === 'pingfederate';
    const step = await fetch(piFlowStepUrl(pending, providerConfig), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Accept: pf ? 'application/json' : '*/*',
        Cookie: piFlowCookieHeader(pending.cookies),
        // PingFederate rejects any request without a CSRF header, whatever its value.
        ...(pf ? { 'X-XSRF-Header': 'PingFederate' } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PI_FLOW_TIMEOUT_MS),
    });
    return { step, body: await step.json().catch(() => ({})), cookies: mergePiFlowCookies(pending.cookies, step) };
  }

  // COMPLETED flow -> authorization code -> the unchanged /callback.
  // PingOne: the code comes from /as/resume. PingFederate: it is already in the
  // COMPLETED response as authorizeResponse.{code,state}.
  async function completePiFlow(req, res, pending, cookies, body) {
    let code = '';
    if (pending.provider === 'pingfederate') {
      const ar = body?.authorizeResponse || {};
      // PF echoes the state it was given; refuse a response for some other request.
      code = ar.state === undefined || ar.state === req.session.oauthState ? (ar.code || '') : '';
    } else {
      const resume = await fetch(`${piFlowBase(pending.provider, providerConfig)}/as/resume?flowId=${pending.flowId}`, {
        headers: { Accept: '*/*', Cookie: piFlowCookieHeader(cookies) },
        redirect: 'manual',
        signal: AbortSignal.timeout(PI_FLOW_TIMEOUT_MS),
      });
      if ((resume.headers.get('content-type') || '').includes('json')) {
        code = (await resume.json().catch(() => ({})))?.authorizeResponse?.code || '';
      }
      if (!code && resume.headers.get('location')) {
        try { code = new URL(resume.headers.get('location')).searchParams.get('code') || ''; } catch (_) { /* not a URL */ }
      }
    }
    if (!code) return res.status(502).json({ error: 'pi_flow_no_code' });

    delete req.session.oauthPiFlow;
    const callback = new URL(req.session.oauthRedirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', req.session.oauthState);
    return req.session.save(() => res.json({ redirectTo: callback.toString() }));
  }

  // What to do with the flow's status after a step. Steps this BFF cannot drive
  // (device selection, policy screens) return fallback:true and the SPA restarts
  // the ordinary redirect login — a sign-in never dead-ends here.
  async function respondAfterPiFlowStep(req, res, pending, body, cookies) {
    if (body.status === 'COMPLETED') return completePiFlow(req, res, pending, cookies, body);
    // Passkey (ASSERTION_REQUIRED) is driven for PingOne only; PF statuses differ.
    if (pending.provider !== 'pingfederate' && body.status === 'ASSERTION_REQUIRED' && body.publicKeyCredentialRequestOptions) {
      req.session.oauthPiFlow = { ...pending, cookies };
      const options = typeof body.publicKeyCredentialRequestOptions === 'string'
        ? JSON.parse(body.publicKeyCredentialRequestOptions) : body.publicKeyCredentialRequestOptions;
      return req.session.save(() => res.json({ step: 'passkey', publicKeyCredentialRequestOptions: options }));
    }
    // One-time passcode (SMS/email MFA): the flow asks for OTP_REQUIRED after the
    // password when the population's policy requires it.
    if (pending.provider !== 'pingfederate' && body.status === 'OTP_REQUIRED') {
      req.session.oauthPiFlow = { ...pending, cookies };
      return req.session.save(() => res.json({ step: 'otp' }));
    }
    return res.json({ fallback: true, status: body.status });
  }

  function openPiFlowOrReject(req, res) {
    const pending = req.session.oauthPiFlow;
    if (!pending?.flowId || !req.session.oauthState || Date.now() - pending.startedAt > 5 * 60 * 1000) {
      res.status(409).json({ error: 'pi_flow_not_started' });
      return null;
    }
    return pending;
  }

  async function handleCredentialsStep(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const pf = pending.provider === 'pingfederate';
      const { step, body, cookies } = await postPiFlowStep(
        pending,
        pf ? 'application/vnd.pingidentity.checkUsernamePassword+json' : 'application/vnd.pingidentity.usernamePassword.check+json',
        { username, password },
      );
      const badCredentials = pf ? 'CREDENTIAL_VALIDATION_FAILED' : 'INVALID_CREDENTIALS';
      if (step.status === 400 && body?.details?.some((d) => d.code === badCredentials)) {
        return res.status(401).json({ error: 'invalid_credentials', message: 'Username or password is incorrect.' });
      }
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] credentials step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }

  async function handleAssertionStep(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    if (pending.provider === 'pingfederate') return res.status(409).json({ error: 'pi_flow_step_unsupported' });
    const { assertion, origin } = req.body || {};
    if (!assertion || typeof assertion !== 'object' || !knownRedirectOrigins.includes(origin)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const { step, body, cookies } = await postPiFlowStep(
        pending, 'application/vnd.pingidentity.assertion.check+json',
        // PingOne requires `assertion` as a JSON string, not an object.
        { origin, assertion: JSON.stringify(assertion), compatibility: 'FULL' },
      );
      if (step.status === 400) {
        return res.status(401).json({ error: 'assertion_failed', message: 'The passkey could not be verified.' });
      }
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] assertion step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }

  // OTP step (SMS/email code): PingOne only. Posts the one-time passcode; an
  // OTP_VALIDATION_FAILED detail maps to 401 so the SPA can re-prompt in place.
  async function handleOtpStep(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    if (pending.provider === 'pingfederate') return res.status(409).json({ error: 'pi_flow_step_unsupported' });
    const { otp } = req.body || {};
    if (typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const { step, body, cookies } = await postPiFlowStep(
        pending, 'application/vnd.pingidentity.otp.check+json', { otp: otp.trim() },
      );
      if (step.status === 400 && body?.details?.some((d) => d.code === 'OTP_VALIDATION_FAILED')) {
        return res.status(401).json({ error: 'invalid_otp', message: 'That code is not valid. Check it and try again.' });
      }
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] OTP step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }

  // Passwordless start (PingOne only): identifies the user with the username
  // alone; the flow then asks for the device step (OTP or assertion), which the
  // existing branches below already drive. A policy that requires the password
  // (or any other status) 409s so the modal returns to the password form.
  async function handlePasswordlessStart(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    if (pending.provider === 'pingfederate') return res.status(409).json({ error: 'pi_flow_step_unsupported' });
    const { username } = req.body || {};
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const { step, body, cookies } = await postPiFlowStep(
        // user.lookup — PingOne's identifier-first action: submits the username
        // without a password and lets the sign-on policy pick the next step
        // (device OTP, passkey, or back to password).
        pending, 'application/vnd.pingidentity.user.lookup+json', { username: username.trim() },
      );
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      // A password-required policy (or any status the device steps can't serve)
      // 409s so the modal returns to the password form with a message — the
      // shared respondAfter fallback ({ fallback: true }) is right for the
      // credentials path but wrong here; this step IS the alternative.
      if (body.status !== 'OTP_REQUIRED' && body.status !== 'ASSERTION_REQUIRED' && body.status !== 'COMPLETED') {
        return res.status(409).json({
          error: 'passwordless_unavailable',
          message: 'This account requires a password. Sign in with your password.',
        });
      }
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] passwordless step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }

  return {
    openPiFlow,
    postPiFlowStep,
    completePiFlow,
    respondAfterPiFlowStep,
    openPiFlowOrReject,
    handleCredentialsStep,
    handleAssertionStep,
    handleOtpStep,
    handlePasswordlessStart,
  };
}

module.exports = { makePiFlowHandlers, piFlowProvider, PI_FLOW_TIMEOUT_MS };
