'use strict';

const axios = require('axios');

const LOGIN_PATH = '/api/auth/oauth/user/login';
const CALLBACK_PATH = '/api/auth/oauth/user/callback';
const STATUS_PATH = '/api/auth/oauth/user/status';

async function httpTransport({ method, url, headers, body }) {
  const response = await axios({ method, url, headers, data: body, maxRedirects: 0, validateStatus: () => true });
  return { status: response.status, headers: response.headers, body: response.data,
    url: response.request?.res?.responseUrl || url };
}

function locationOf(response, base) {
  const location = response?.headers?.location;
  if (!location) throw new Error('Provider login protocol failed.');
  try { return new URL(location, base); } catch { throw new Error('Provider login protocol failed.'); }
}

function formOf(html, base) {
  const source = String(html || '');
  const action = source.match(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!action) throw new Error('Provider login form was missing.');
  const fields = new URLSearchParams();
  for (const input of source.matchAll(/<input\b[^>]*>/gi)) {
    const name = input[0].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const value = input[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    if (name) fields.append(name, value);
  }
  try { return { action: new URL(action, base), fields }; }
  catch { throw new Error('Provider login form was invalid.'); }
}

async function createDemoReadinessProviderLoginClient({ provider, dedicatedBffUrl, identityRef, username, password,
  expectedIssuer, expectedSubject, transport = httpTransport } = {}) {
  if (!['pingone', 'pingfederate'].includes(provider)
    || [identityRef, username, password, expectedIssuer, expectedSubject]
      .some(value => typeof value !== 'string' || !value.trim())
    || typeof transport !== 'function') {
    throw new Error('Provider login configuration is incomplete.');
  }
  let bff;
  try { bff = new URL(dedicatedBffUrl); } catch { throw new Error('Dedicated BFF URL is invalid.'); }
  if (bff.protocol !== 'https:' || bff.username || bff.password || bff.search || bff.hash || bff.pathname !== '/') {
    throw new Error('Dedicated BFF URL is invalid.');
  }

  const jars = new Map();
  let disposed = false;
  const assertLive = () => { if (disposed) throw new Error('Provider login session was disposed.'); };
  const sameOrigin = (url, origin) => {
    if (url.origin !== origin) throw new Error('Provider login origin mismatch.');
  };
  async function send(method, url, body, contentType) {
    assertLive();
    const target = new URL(url);
    const jar = jars.get(target.origin) || new Map();
    const headers = {};
    if (jar.size) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (contentType) headers['Content-Type'] = contentType;
    let response;
    try { response = await transport({ method, url: target.href, headers, body }); }
    catch { throw new Error('Provider login transport failed.'); }
    let effectiveUrl;
    try { effectiveUrl = new URL(response?.url || target.href, target.href); }
    catch { throw new Error('Provider login origin mismatch.'); }
    sameOrigin(effectiveUrl, target.origin);
    if (response?.status == null) throw new Error('Provider login transport failed.');
    const setCookies = response.headers?.['set-cookie'] || [];
    for (const cookie of Array.isArray(setCookies) ? setCookies : [setCookies]) {
      const pair = String(cookie).split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    jars.set(target.origin, jar);
    return response;
  }

  try {
    const login = await send('GET', new URL(LOGIN_PATH, bff).href);
    if (login.status !== 302) throw new Error('Provider login did not start.');
    const authorize = locationOf(login, bff);
    if (authorize.protocol !== 'https:' || authorize.origin === bff.origin) throw new Error('Provider login origin mismatch.');
    const providerOrigin = authorize.origin;
    // The BFF adds login_hint=<demo user> for the presenter. PingFederate then
    // makes the username field read-only and signs in as THAT user, ignoring
    // the one posted. This client signs in as the lane identity, so it drops
    // the hint, as a browser user would by choosing another account.
    authorize.searchParams.delete('login_hint');
    const first = await send('GET', authorize.href);
    let callback;

    if (provider === 'pingfederate') {
      sameOrigin(authorize, providerOrigin);
      const signon = formOf(first.body, authorize);
      sameOrigin(signon.action, providerOrigin);
      signon.fields.set('pf.username', username);
      signon.fields.set('pf.pass', password);
      signon.fields.set('pf.ok', '');
      const signedIn = await send('POST', signon.action.href, signon.fields.toString(), 'application/x-www-form-urlencoded');
      if (signedIn.status === 302) {
        callback = locationOf(signedIn, signon.action);
      } else if (signedIn.status === 200) {
        const consent = formOf(signedIn.body, signon.action);
        sameOrigin(consent.action, providerOrigin);
        if (!consent.fields.has('pf.oauth.authz.consent')) throw new Error('Provider login protocol failed.');
        consent.fields.set('pf.oauth.authz.consent', 'true');
        if (String(signedIn.body).includes('name="check-user-approved-scope"')) consent.fields.set('check-user-approved-scope', 'true');
        const approved = await send('POST', consent.action.href, consent.fields.toString(), 'application/x-www-form-urlencoded');
        if (approved.status !== 302) throw new Error('Provider login protocol failed.');
        callback = locationOf(approved, consent.action);
      } else throw new Error('Provider login protocol failed.');
    } else {
      // PingOne serves the sign-on PAGE from a different host than the
      // authorization server (auth.pingone.* -> apps.pingone.*/<env>/signon/).
      // Only the flowId is read from that redirect; credentials are posted to
      // the flow API built on the /as/authorize origin below, so the page's
      // origin must be HTTPS but need not match.
      let flowRedirect = locationOf(first, authorize);
      if (flowRedirect.protocol !== 'https:') throw new Error('Provider login origin mismatch.');
      if (!flowRedirect.searchParams.get('flowId')) {
        sameOrigin(flowRedirect, providerOrigin);
        const intermediate = await send('GET', flowRedirect.href);
        flowRedirect = locationOf(intermediate, flowRedirect);
        if (flowRedirect.protocol !== 'https:') throw new Error('Provider login origin mismatch.');
      }
      const flowId = flowRedirect.searchParams.get('flowId');
      const segments = authorize.pathname.split('/').filter(Boolean);
      const env = segments[0];
      if (!flowId || !env) throw new Error('Provider login protocol failed.');
      const flowUrl = new URL(`/${encodeURIComponent(env)}/flows/${encodeURIComponent(flowId)}`, authorize);
      let checked = await send('POST', flowUrl.href, { username, password }, 'application/vnd.pingidentity.usernamePassword.check+json');
      // A readiness identity that has never signed in is asked to accept the
      // environment's agreement once. Accept it on the same flow URL only.
      if (checked.status === 200 && checked.body?.status === 'AGREEMENT_CONSENT_REQUIRED'
        && checked.body?._links?.['agreement.accept']?.href === flowUrl.href) {
        checked = await send('POST', flowUrl.href, { accept: true }, 'application/vnd.pingidentity.user.consent+json');
      }
      if (checked.status !== 200 || checked.body?.status !== 'COMPLETED') throw new Error('Provider login protocol failed.');
      const resumeUrl = new URL(`/${encodeURIComponent(env)}/as/resume`, authorize);
      resumeUrl.searchParams.set('flowId', flowId);
      const resumed = await send('GET', resumeUrl.href);
      if (resumed.status !== 302) throw new Error('Provider login protocol failed.');
      callback = locationOf(resumed, resumeUrl);
    }

    sameOrigin(callback, bff.origin);
    if (callback.pathname !== CALLBACK_PATH || !callback.searchParams.get('code') || !callback.searchParams.get('state')) {
      throw new Error('Provider login callback was invalid.');
    }
    const completed = await send('GET', callback.href);
    if (completed.status !== 302 && completed.status !== 200) throw new Error('Provider login callback failed.');
    const status = await send('GET', new URL(STATUS_PATH, bff).href);
    const statusProvider = provider === 'pingone' ? 'pingone_sso' : provider;
    if (status.status !== 200 || status.body?.authenticated !== true || status.body?.loginProvider !== statusProvider
      || status.body?.oauthProvider !== provider || status.body?.oauthIssuer !== expectedIssuer
      || status.body?.user?.providerSubject !== expectedSubject) {
      throw new Error('Provider login verification failed.');
    }
    return Object.freeze({
      authenticated: true, provider,
      async request(path, { method = 'GET', body, headers } = {}) {
        assertLive();
        const target = new URL(path, bff);
        sameOrigin(target, bff.origin);
        if (headers) throw new Error('Custom session headers are unavailable.');
        return send(method, target.href, body);
      },
      dispose() { disposed = true; jars.clear(); },
    });
  } catch (error) {
    disposed = true;
    jars.clear();
    throw error;
  }
}

module.exports = { createDemoReadinessProviderLoginClient };
