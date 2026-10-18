'use strict';
// Shared pi.flow driver for the BFF's redirect-free sign-in (user + admin).
// Extracted verbatim from routes/oauthUser.js so the admin router can drive the
// same flow: /login?pi_flow=1 opens the flow, POST /pi-flow/credentials drives
// it, and a COMPLETED flow hands the browser to the UNCHANGED /callback with
// ?code&state — so PKCE, nonce and session creation all stay where they are.
// Anything a step can't finish (MFA, a policy screen) returns {fallback:true}
// and the SPA starts the ordinary redirect login instead.
const configStore = require('./configStore');
const cibaLoginEnabled = require('./cibaLoginFlag');
const { fetchPingOneUserByUsername, fetchPingOneUserByEmail } = require('./pingOneUserLookupService');

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
// A parked flow (password done, approval pending) expires after this long.
const PARKED_FLOW_TTL_MS = 150_000;

// allowSecondFactor: true ONLY for the customer router. The admin router never parks.
function makePiFlowHandlers({ providerConfig, knownRedirectOrigins, allowSecondFactor = false }) {
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
      // A new login supersedes any parked (password-verified) flow of this session.
      delete req.session.oauthPiFlowParked;
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
  async function finishPiFlow(req, pending, cookies, body) {
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
    if (!code) return { status: 502, error: 'pi_flow_no_code' };

    delete req.session.oauthPiFlow;
    const callback = new URL(req.session.oauthRedirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', req.session.oauthState);
    return { redirectTo: callback.toString() };
  }

  async function completePiFlow(req, res, pending, cookies, body, extra = {}) {
    const result = await finishPiFlow(req, pending, cookies, body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return req.session.save(() => res.json({ redirectTo: result.redirectTo, ...extra }));
  }

  // --- Parked flow: password verified, login withheld until a second factor ---
  const clearParked = (req) => { delete req.session.oauthPiFlowParked; };

  function getParkedFlow(req) {
    const parked = req.session?.oauthPiFlowParked;
    if (!parked) return null;
    if (!(Date.now() - parked.parkedAt <= PARKED_FLOW_TTL_MS)) {
      clearParked(req);
      return null;
    }
    return { expectedSub: parked.expectedSub, username: parked.username, user: parked.user };
  }

  // Milliseconds left of the parked window (null if none). Read-only: never extends parkedAt.
  function getParkedRemainingMs(req) {
    return getParkedFlow(req) ? PARKED_FLOW_TTL_MS - (Date.now() - req.session.oauthPiFlowParked.parkedAt) : null;
  }

  function discardParkedFlow(req) { clearParked(req); }

  // Single use: the parked state is deleted (and persisted) BEFORE the code is fetched.
  async function completeParkedFlow(req) {
    const parked = getParkedFlow(req) && req.session.oauthPiFlowParked;
    if (!parked) return { status: 409, error: 'no_parked_flow' };
    clearParked(req);
    const saveErr = await new Promise((resolve) => { req.session.save((err) => resolve(err)); });
    if (saveErr) return { status: 502, error: 'approval_unavailable' }; // fail closed: never finish unless the burn was persisted
    try {
      return await finishPiFlow(req, parked.pending, parked.cookies, parked.body);
    } catch (error) {
      console.warn('[oauth/pi-flow] parked completion failed:', error.message);
      return { status: 502, error: 'pi_flow_failed' };
    }
  }

  // Park a finished password flow when the browser asked for a CIBA second factor.
  // Returns null (factor not requested), { channels } (parked), { passthrough } (PF user with
  // no PingOne account: normal completion) or { unavailable } (FAIL CLOSED: any failure to
  // identify the account must never degrade to a password-only session).
  // The typed username is cross-checked against the resolved account so a crafted value
  // (another user's id/email) cannot park a flow whose approver is a different person.
  // Known gaps, by design: only a COMPLETED straight from the password step parks (a flow
  // reaching COMPLETED after identifier-first lookup, OTP, passkey or PF MFA_COMPLETED never
  // does), and single use is per session, not atomic across truly concurrent requests (the
  // downstream PingOne resume / PF code are themselves single-use).
  async function parkIfSecondFactor(req, pending, cookies, body, username) {
    if (!secondFactorRequested(req)) return null;
    const typed = username.trim();
    const pf = pending.provider === 'pingfederate';
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    // Username-only lookup removes the UUID-by-id ambiguity. An email-looking value is
    // tried as a username first (that match wins); only then as an email, and only when
    // EXACTLY ONE account has that email (accounts can share one: ambiguous = fail closed).
    let lookup = await fetchPingOneUserByUsername(typed);
    if (!pf && typed.includes('@') && !(lookup?.user && same(lookup.user.username, typed))
        && (!lookup?.error || lookup.error === 'not_found')) {
      const byEmail = await fetchPingOneUserByEmail(typed);
      lookup = byEmail?.count === 1 ? byEmail : { user: null, error: byEmail?.error || 'ambiguous_email' };
    }
    const user = lookup?.user;
    if (!user?.id) {
      return pf && lookup?.error === 'not_found' ? { passthrough: true } : { unavailable: true };
    }
    if (!same(user.username, typed) && !(typed.includes('@') && same(user.email, typed))) return { unavailable: true };
    if (user.enabled === false) return { unavailable: true };
    const channels = [];
    if (user.email) channels.push('email');
    if (user.mobilePhone) channels.push('sms');
    if (!channels.length) return { passthrough: true }; // nothing to approve on
    const { id, username: uname, email, mobilePhone, enabled } = user;
    req.session.oauthPiFlowParked = {
      pending, cookies, body, username,
      expectedSub: id,
      user: { id, username: uname, email, mobilePhone, enabled },
      parkedAt: Date.now(),
    };
    delete req.session.oauthPiFlow;
    return { channels };
  }

  const secondFactorRequested = (req) => allowSecondFactor
    && req.body?.secondFactor === 'ciba'
    && cibaLoginEnabled();

  // What to do with the flow's status after a step. Steps this BFF cannot drive
  // (policy screens) return fallback:true and the SPA restarts the ordinary
  // redirect login — a sign-in never dead-ends here.
  async function respondAfterPiFlowStep(req, res, pending, body, cookies, extra = {}) {
    // PingFederate's PingOne MFA adapter ends at MFA_COMPLETED; continueAuthentication moves the
    // policy on (to COMPLETED with the authorizeResponse). Unhandled, it fell back to the hosted
    // login page, which asked for the password after a successful code.
    if (pending.provider === 'pingfederate' && body.status === 'MFA_COMPLETED') {
      const next = await postPiFlowStep({ ...pending, cookies }, 'application/vnd.pingidentity.continueAuthentication+json', {});
      if (!next.step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return respondAfterPiFlowStep(req, res, pending, next.body, next.cookies, extra);
    }
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
      // PingOne: usableStatus/email/phone. PingFederate's MFA adapter: usable + a masked `target`.
      const devices = rawDevices
        .filter((d) => (d.usableStatus?.status || 'ENABLED') === 'ENABLED' && d.usable !== false)
        // PF's passkey step (checkAssertion) is not driven yet: don't offer a device that can't finish.
        .filter((d) => !(pending.provider === 'pingfederate' && /^fido2$/i.test(d.type)))
        .map((d) => ({
          id: d.id,
          type: d.type,
          nickname: d.nickname || null,
          email: d.email || (/^email$/i.test(d.type) ? d.target : null) || null,
          phone: d.phone || (/^(sms|voice)$/i.test(d.type) ? d.target : null) || null,
        }));
      return req.session.save(() => res.json({
        step: body.status === 'OTP_REQUIRED' ? 'otp' : 'device',
        devices,
        selectedDeviceId: body.selectedDevice?.id || null,
        aggregateFido2Devices: Boolean(body.aggregateFido2Devices),
      }));
    }
    return res.json({ fallback: true, status: body.status, ...extra });
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
      if (body?.status === 'COMPLETED') {
        const parked = await parkIfSecondFactor(req, pending, cookies, body, username);
        if (parked?.unavailable) return res.status(502).json({ error: 'approval_unavailable' });
        if (parked?.passthrough) return await completePiFlow(req, res, pending, cookies, body, { secondFactorSkipped: true });
        if (parked?.channels) {
          return req.session.save((err) => {
            if (err) { delete req.session.oauthPiFlowParked; return res.status(502).json({ error: 'approval_unavailable' }); }
            return res.json({ step: 'approval', channels: parked.channels });
          });
        }
      }
      return await respondAfterPiFlowStep(req, res, pending, body, cookies, secondFactorRequested(req) ? { secondFactorSkipped: true } : {});
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
    const pf = pending.provider === 'pingfederate';
    const { otp } = req.body || {};
    if (typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const { step, body, cookies } = await postPiFlowStep(
        pending, pf ? 'application/vnd.pingidentity.checkOtp+json' : 'application/vnd.pingidentity.otp.check+json', { otp: otp.trim() },
      );
      const badOtp = pf ? 'INVALID_OTP' : 'OTP_VALIDATION_FAILED';
      if (step.status === 400 && body?.details?.some((d) => d.code === badOtp)) {
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
    const { username } = req.body || {};
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    if (pending.provider === 'pingfederate') return pfPasswordlessStart(req, res, pending, username.trim());
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

  // PingFederate passwordless: acr_values=mfa_only selects identifier first -> PingOne MFA adapter
  // (scripts/pingfederate/enable-pf-passwordless.js). The flow opens at IDENTIFIER_REQUIRED, or at
  // AUTHENTICATION_REQUIRED when PF already took the login_hint; `authenticate` starts the MFA adapter,
  // whose device/OTP steps the shared responder serves. Opening on the password form means the
  // policy has no mfa_only branch: 409 back to the password form, PF not called.
  async function pfPasswordlessStart(req, res, pending, username) {
    if (pending.status !== 'IDENTIFIER_REQUIRED' && pending.status !== 'AUTHENTICATION_REQUIRED') {
      return res.status(409).json({ error: 'passwordless_unavailable', message: 'Passwordless sign-in is not set up on PingFederate. Sign in with your password.' });
    }
    try {
      let flow = pending;
      let result = null;
      if (flow.status === 'IDENTIFIER_REQUIRED') {
        result = await postPiFlowStep(flow, 'application/vnd.pingidentity.submitIdentifier+json', { identifier: username });
        if (!result.step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
        flow = { ...flow, cookies: result.cookies, status: result.body.status };
      }
      if (flow.status === 'AUTHENTICATION_REQUIRED') {
        result = await postPiFlowStep(flow, 'application/vnd.pingidentity.authenticate+json', {});
        if (!result.step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      }
      return await respondAfterPiFlowStep(req, res, flow, result.body, result.cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] PF passwordless step failed:', error.message);
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
        pf ? 'application/vnd.pingidentity.selectDevice+json' : 'application/vnd.pingidentity.device.select+json',
        // PF's selectDevice takes { deviceRef: { id } } (plain { deviceId } is a 400); PingOne nests it as device.id.
        pf ? { deviceRef: { id: deviceId } } : { device: { id: deviceId } },
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
    finishPiFlow,
    getParkedFlow,
    getParkedRemainingMs,
    completeParkedFlow,
    discardParkedFlow,
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
