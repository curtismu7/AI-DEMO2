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
      req.session.oauthPiFlow = { flowId: flow.id, provider, startedAt: Date.now(), cookies: mergePiFlowCookies({}, r), status: flow.status };
      // Echo the authorize request's login_hint so the SPA can prefill, as the
      // hosted login page does. PingFederate BINDS the flow to the hint
      // ("Username must match the provided username hint"); for PingOne the
      // hint is advisory prefill only — signing in as someone else is fine.
      const usernameHint = new URL(authorizeUrl).searchParams.get('login_hint') || null;
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
    const body = await step.json().catch(() => ({}));
    // A non-ok PingOne answer used to vanish into a caller's bare 502 with the
    // body discarded — undiagnosable post-hoc (a transient network blip read
    // exactly like an unknown flow status). Log it once, at the one place every
    // step response passes through.
    if (!step.ok) {
      console.warn('[oauth/pi-flow] step not ok: HTTP %s %s %s', step.status, body?.code || '(no code)', body?.details?.[0]?.message || '');
    }
    return { step, body, cookies: mergePiFlowCookies(pending.cookies, step) };
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
  // (policy screens) return fallback:true and the SPA restarts the ordinary
  // redirect login — a sign-in never dead-ends here.
  async function respondAfterPiFlowStep(req, res, pending, body, cookies) {
    if (body.status === 'COMPLETED') return completePiFlow(req, res, pending, cookies, body);
    // Passkey (ASSERTION_REQUIRED) — both providers. PF's shape carries the same
    // publicKeyCredentialRequestOptions; PingOne stringifies it.
    if (body.status === 'ASSERTION_REQUIRED' && body.publicKeyCredentialRequestOptions) {
      req.session.oauthPiFlow = { ...pending, cookies };
      const options = typeof body.publicKeyCredentialRequestOptions === 'string'
        ? JSON.parse(body.publicKeyCredentialRequestOptions) : body.publicKeyCredentialRequestOptions;
      return req.session.save(() => res.json({ step: 'passkey', publicKeyCredentialRequestOptions: options }));
    }
    // One-time passcode (SMS/email MFA). The response may carry the device list
    // (PingOne: _embedded.devices, selectedDevice) — surfaced to the modal so it
    // can offer a picker when more than one device exists. PF's equivalent
    // DEVICE_SELECTION_REQUIRED carries `devices` at the top level and is a
    // separate step (handled in the device branch below).
    if (body.status === 'OTP_REQUIRED' || body.status === 'DEVICE_SELECTION_REQUIRED') {
      req.session.oauthPiFlow = { ...pending, cookies };
      const rawDevices = body._embedded?.devices || body.devices || [];
      const devices = rawDevices
        .filter((d) => (d.usableStatus?.status || 'ENABLED') === 'ENABLED')
        .map((d) => ({
          id: d.id,
          type: d.type,
          nickname: d.nickname || null,
          email: d.email || null,
          phone: d.phone || null,
        }));
      return req.session.save(() => res.json({
        step: body.status === 'OTP_REQUIRED' ? 'otp' : 'device',
        devices,
        selectedDeviceId: body.selectedDevice?.id || null,
        aggregateFido2Devices: Boolean(body.aggregateFido2Devices),
      }));
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
    let pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const pf = pending.provider === 'pingfederate';
      // An identifier-first policy opens the flow at SIGN_ON_REQUIRED, where
      // usernamePassword.check is rejected (wrong flow status) — identify
      // first, then submit the password. PF never opens in this state.
      if (!pf && pending.status === 'SIGN_ON_REQUIRED') {
        const lookup = await postPiFlowStep(
          pending, 'application/vnd.pingidentity.user.lookup+json', { username },
        );
        if (!lookup.step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
        // Identified without needing a password (device-first MFA): hand the flow
        // to the responder right away. Only PASSWORD_REQUIRED continues below.
        if (lookup.body.status !== 'PASSWORD_REQUIRED') {
          return await respondAfterPiFlowStep(req, res, pending, lookup.body, lookup.cookies);
        }
        pending = { ...pending, cookies: lookup.cookies, status: lookup.body.status };
      }
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
      // DEVICE_SELECTION_REQUIRED: the user has several devices and no default.
      if (!['OTP_REQUIRED', 'ASSERTION_REQUIRED', 'DEVICE_SELECTION_REQUIRED', 'COMPLETED'].includes(body.status)) {
        // The lookup already advanced the PingOne flow (e.g. to PASSWORD_REQUIRED):
        // persist it, or the password form re-sends user.lookup and PingOne 400s.
        req.session.oauthPiFlow = { ...pending, cookies, status: body.status };
        return req.session.save(() => res.status(409).json({
          error: 'passwordless_unavailable',
          message: 'This account requires a password. Sign in with your password.',
        }));
      }
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] passwordless step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }

  // Device selection: the user picked one of the devices the flow offered
  // (OTP_REQUIRED's _embedded.devices / DEVICE_SELECTION_REQUIRED's devices).
  // PingOne wants application/vnd.pingidentity.device.select+json with
  // { device: { id } }; a FIDO2 selection then returns ASSERTION_REQUIRED with
  // the WebAuthn options, an OTP device returns a fresh OTP_REQUIRED.
  async function handleDeviceSelectStep(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9-]{6,64}$/.test(deviceId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const pf = pending.provider === 'pingfederate';
    try {
      const { step, body, cookies } = await postPiFlowStep(
        pending,
        pf ? 'application/json' : 'application/vnd.pingidentity.device.select+json',
        // PF's selectDevice takes { deviceId }; PingOne nests it.
        pf ? { deviceId } : { device: { id: deviceId } },
      );
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] device select step failed:', error.message);
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
    handleDeviceSelectStep,
  };
}

module.exports = { makePiFlowHandlers, piFlowProvider, PI_FLOW_TIMEOUT_MS };
