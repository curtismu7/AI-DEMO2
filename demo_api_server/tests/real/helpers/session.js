'use strict';

const path = require('path');
const fs   = require('fs');
const axios  = require('axios');

const { BFF_BASE, httpsAgent } = require('./constants');

const SESSION_CACHE = path.resolve(__dirname, '../../../.test-session.json');

async function loginViaBff({ envId, region, username, password, loginPath, callbackPath }) {
  const bff = axios.create({ baseURL: BFF_BASE, httpsAgent, maxRedirects: 0, validateStatus: () => true });
  let bffCookies = '';

  function extractBffCookies(r) {
    return (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  }
  function merge(existing, fresh) {
    if (!fresh) return existing;
    const map = new Map();
    for (const p of (existing || '').split('; ').filter(Boolean)) { const [k,...v]=p.split('='); map.set(k,v.join('=')); }
    for (const p of fresh.split('; ').filter(Boolean)) { const [k,...v]=p.split('='); map.set(k,v.join('=')); }
    return [...map.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
  }

  const r1 = await bff.get(loginPath, { headers: { Cookie: bffCookies } });
  bffCookies = merge(bffCookies, extractBffCookies(r1));
  const pingLoc = r1.headers.location || '';
  if (!pingLoc) throw new Error(`BFF ${loginPath} did not redirect to PingOne`);

  let pCookies = '';
  const r2 = await axios.get(pingLoc, { maxRedirects: 0, validateStatus: () => true, httpsAgent });
  pCookies = merge(pCookies, (r2.headers['set-cookie'] || []).map(c=>c.split(';')[0]).join('; '));
  const loc2 = r2.headers.location || '';

  // PingFederate deployments render the sign-on as an HTML form whose action is
  // the resume URL (no redirect chain, no flowId). PingOne redirects to
  // auth.pingone.com/.../flows/<id>. Branch on which shape came back.
  const r2Body = typeof r2.data === 'string' ? r2.data : '';
  const isPfForm = !loc2 && r2Body.includes('<form') && /pf\.username/.test(r2Body);

  if (isPfForm) {
    // PF hosted-form login: POST pf.username/pf.pass to the form action (a
    // /as/<id>/resume URL), submit the consent page (scope checkboxes +
    // pf.oauth.authz.consent=true), then follow the 302 chain to the callback.
    const pfOrigin = new URL(pingLoc).origin;
    const signonAction = new URL(r2Body.match(/<form[^>]*action="([^"]+)"/)[1], pfOrigin).href;
    const hidden = {};
    for (const m of r2Body.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) hidden[m[1]] = m[2];
    const signonBody = new URLSearchParams({ ...hidden, 'pf.username': username, 'pf.pass': password, 'pf.ok': '' }).toString();
    const r3 = await axios.post(signonAction, signonBody.toString(), {
      maxRedirects: 0, validateStatus: () => true, httpsAgent,
      headers: { Cookie: pCookies, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    pCookies = merge(pCookies, (r3.headers['set-cookie'] || []).map(c=>c.split(';')[0]).join('; '));
    const html3 = String(r3.data);
    if (html3.includes('We didn') || (r3.headers.location || '').includes('error_description=Authenti')) {
      throw new Error('loginViaBff(PF): PingFederate rejected the credentials');
    }
    // Consent page (200) — find its form, echo all inputs incl. scope checkboxes.
    if (html3.includes('Request for Approval') || html3.includes('allowButton')) {
      const consentAction = new URL(html3.match(/<form[^>]*action="([^"]+)"/)[1], pfOrigin).href;
      const b3 = new URLSearchParams();
      if (html3.match(/name="check-user-approved-scope"/)) b3.set('check-user-approved-scope', 'true');
      for (const m of html3.matchAll(/<input[^>]*name="scope"[^>]*value="([^"]*)"/g)) b3.append('scope', m[1]);
      const csrf = (html3.match(/name="cSRFToken" value="([^"]*)"/) || [])[1];
      if (csrf) b3.set('cSRFToken', csrf);
      b3.set('pf.oauth.authz.consent', 'true');
      const r4 = await axios.post(consentAction, b3.toString(), {
        maxRedirects: 0, validateStatus: () => true, httpsAgent,
        headers: { Cookie: pCookies, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      pCookies = merge(pCookies, (r4.headers['set-cookie'] || []).map(c=>c.split(';')[0]).join('; '));
      const cbLoc = r4.headers.location || '';
      if (!cbLoc) throw new Error('loginViaBff(PF): consent submit did not redirect');
      const code = new URL(cbLoc).searchParams.get('code');
      const errR = new URL(cbLoc).searchParams.get('error_description');
      if (errR) throw new Error(`loginViaBff(PF): consent error: ${decodeURIComponent(errR)}`);
      if (!code) throw new Error('loginViaBff(PF): no code after consent');
      const callbackUrl = `${callbackPath}?code=${code}&state=${new URL(cbLoc).searchParams.get('state') || ''}`;
      const r5 = await bff.get(callbackUrl, { headers: { Cookie: bffCookies } });
      bffCookies = merge(bffCookies, extractBffCookies(r5));
      const sidEntry = bffCookies.split('; ').find(p => p.startsWith('connect.sid='));
      if (!sidEntry) throw new Error('loginViaBff(PF): no connect.sid in BFF cookies after callback');
      return sidEntry;
    }
    // No consent screen — the sign-on POST itself should have redirected to the callback.
    const cbLoc = r3.headers.location || '';
    const code = cbLoc ? new URL(cbLoc).searchParams.get('code') : null;
    if (!code) throw new Error('loginViaBff(PF): neither consent page nor callback redirect after sign-on');
    const callbackUrl = `${callbackPath}?code=${code}&state=${new URL(cbLoc).searchParams.get('state') || ''}`;
    const r5 = await bff.get(callbackUrl, { headers: { Cookie: bffCookies } });
    bffCookies = merge(bffCookies, extractBffCookies(r5));
    const sidEntry = bffCookies.split('; ').find(p => p.startsWith('connect.sid='));
    if (!sidEntry) throw new Error('loginViaBff(PF): no connect.sid in BFF cookies after callback');
    return sidEntry;
  }

  let flowId;
  try { flowId = new URL(loc2).searchParams.get('flowId'); } catch(_) {}
  if (!flowId) {
    const r2b = await axios.get(loc2, { maxRedirects:0, validateStatus:()=>true, httpsAgent, headers:{Cookie:pCookies} });
    pCookies = merge(pCookies, (r2b.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '));
    try { flowId = new URL(r2b.headers.location||'').searchParams.get('flowId'); } catch(_) {}
  }
  if (!flowId) throw new Error('loginViaBff: could not extract flowId');

  // Take the origin AND the environment id from the authorize URL the BFF just
  // redirected to, rather than rebuilding them from env vars.
  //
  // PINGONE_ENVIRONMENT_ID is not set for the e2e runner — it is absent from
  // .env, tests/e2e/.env.e2e and the shell — so `envId` was undefined and every
  // headless login built https://auth.pingone.com/undefined/flows/<id>, which
  // PingOne answers with a bare 400 INVALID_REQUEST and no field detail. The
  // redirect target cannot be undefined and cannot drift from whatever
  // environment the BFF is really configured against, which is the environment
  // the flow actually lives in.
  let authOrigin;
  let flowEnvId;
  try {
    const u = new URL(pingLoc);
    authOrigin = u.origin;
    [, flowEnvId] = u.pathname.split('/');
  } catch (_) { /* fall through to the env-var form below */ }
  if (!flowEnvId) {
    authOrigin = `https://auth.pingone.${region || 'com'}`;
    flowEnvId = envId;
  }
  if (!flowEnvId) throw new Error('loginViaBff: could not determine PingOne environment id');

  const base    = `${authOrigin}/${flowEnvId}/as`;
  const flowUrl = `${authOrigin}/${flowEnvId}/flows/${flowId}`;
  const rc = await axios.post(flowUrl, { username, password }, {
    headers: { 'Content-Type': 'application/vnd.pingidentity.usernamePassword.check+json', Cookie: pCookies },
    validateStatus:()=>true, httpsAgent,
  });
  pCookies = merge(pCookies, (rc.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '));
  if (rc.data?.status !== 'COMPLETED') {
    // Report what PingOne actually said. `status` is undefined whenever the
    // response is not a flow object at all — an error envelope, an MFA/consent
    // step, an expired flow — so "flow not COMPLETED: undefined" named the one
    // field guaranteed to be missing while hiding every field that identifies the
    // cause. It cost an afternoon. The whole body, not a hand-picked subset:
    // PingOne puts the actionable part in `details[].target` when it sends one.
    const detail = (typeof rc.data === 'object' ? JSON.stringify(rc.data) : String(rc.data)).slice(0, 500);
    throw new Error(`loginViaBff: flow not COMPLETED (HTTP ${rc.status}, status=${rc.data?.status}): ${detail}`);
  }

  const rr = await axios.get(`${base}/resume?flowId=${flowId}`, {
    maxRedirects:0, validateStatus:()=>true, httpsAgent, headers:{Cookie:pCookies},
  });
  const resumeLoc = rr.headers.location || '';
  const code = new URL(resumeLoc).searchParams.get('code');
  const errR = new URL(resumeLoc).searchParams.get('error');
  if (errR) throw new Error(`loginViaBff: PingOne error: ${errR}`);
  if (!code) throw new Error('loginViaBff: no code in resume redirect');

  const callbackUrl = `${callbackPath}?code=${code}&state=${new URL(resumeLoc).searchParams.get('state')||''}`;
  const r4 = await bff.get(callbackUrl, { headers: { Cookie: bffCookies } });
  bffCookies = merge(bffCookies, extractBffCookies(r4));

  const sidEntry = bffCookies.split('; ').find(p => p.startsWith('connect.sid='));
  if (!sidEntry) throw new Error('loginViaBff: no connect.sid in BFF cookies after callback');
  return sidEntry;
}

// Per-persona BFF routes: enduser uses the user OAuth client; admin uses the admin client.
const PERSONA_ROUTES = {
  enduser: {
    loginPath:    '/api/auth/oauth/user/login',
    callbackPath: '/api/auth/oauth/user/callback',
    oauthType:    'user',
  },
  admin: {
    loginPath:    '/api/auth/oauth/login',
    callbackPath: '/api/auth/oauth/callback',
    oauthType:    'admin',
  },
};

function loadFromLmdb(oauthType) {
  try {
    const { open } = require('lmdb');
    const lmdbPath = path.resolve(__dirname, '../../../data/persistent/lmdb');
    if (!fs.existsSync(lmdbPath)) return null;
    const env = open({ path: lmdbPath, maxDbs: 16, encoding: 'json', readOnly: true });
    const db = env.openDB('sessions', { encoding: 'json' });
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    for (const { key, value } of db.getRange()) {
      try {
        if (!value || value.expire <= now) continue;
        const sess = value.sess;
        const at = sess?.oauthTokens?.accessToken;
        if (!at) continue;
        if (oauthType && sess.oauthType && sess.oauthType !== oauthType) continue;
        const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString());
        if (payload.exp > nowSec) {
          env.close();
          return `connect.sid=${encodeURIComponent(`s:${key}`)}`;
        }
      } catch (_) { /* skip malformed */ }
    }
    env.close();
    return null;
  } catch (_) {
    return null;
  }
}

async function resolveSession(persona = 'enduser') {
  const cached = fs.existsSync(SESSION_CACHE) ? JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8')) : {};
  if (cached[persona] && cached[persona] !== 'skip') return cached[persona];

  const envId  = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const routes  = PERSONA_ROUTES[persona] || PERSONA_ROUTES.admin;

  const enduserUser =
    process.env.DEMO_USER_USERNAME || process.env.PINGONE_TEST_USER || process.env.E2E_CUSTOMER_USERNAME;
  const enduserPass =
    process.env.DEMO_USER_PASSWORD || process.env.PINGONE_TEST_PASSWORD || process.env.E2E_CUSTOMER_PASSWORD;

  if (persona === 'enduser' && enduserUser && enduserPass) {
    try {
      return await loginViaBff({ envId, region,
        username: enduserUser,
        password: enduserPass,
        loginPath:    routes.loginPath,
        callbackPath: routes.callbackPath,
      });
    } catch (e) {
      console.warn(`[session] Headless enduser login failed: ${e.message} — falling back to the LMDB session store`);
    }
  }

  const adminUser = process.env.DEMO_ADMIN_USERNAME || process.env.PINGONE_TEST_ADMIN_USER;
  const adminPass = process.env.DEMO_ADMIN_PASSWORD || process.env.PINGONE_TEST_ADMIN_PASSWORD;

  if (persona === 'admin' && adminUser && adminPass) {
    try {
      return await loginViaBff({ envId, region,
        username: adminUser,
        password: adminPass,
        loginPath:    routes.loginPath,
        callbackPath: routes.callbackPath,
      });
    } catch (e) {
      console.warn(`[session] Headless admin login failed: ${e.message} — falling back to the LMDB session store`);
    }
  }

  const lmdbCookie = loadFromLmdb(routes.oauthType);
  if (lmdbCookie) return lmdbCookie;

  return null;
}

module.exports = { resolveSession, loginViaBff, SESSION_CACHE };
