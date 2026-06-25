#!/usr/bin/env node
/**
 * Quick test of the headless PingOne login flow.
 * Uses manual Set-Cookie/Cookie header handling (no extra deps).
 * Run: node src/__tests__/_headless-login-test.js
 */
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const envId = process.env.PINGONE_ENVIRONMENT_ID;
const clientId = process.env.PINGONE_USER_CLIENT_ID;
const clientSecret = process.env.PINGONE_USER_CLIENT_SECRET;
const redirectUri = process.env.PUBLIC_APP_URL + '/api/auth/oauth/user/callback';
const username = process.env.USERNAME;
const password = process.env.PASSWORD;

const base = `https://auth.pingone.com/${envId}/as`;
const verifier = crypto.randomBytes(64).toString('hex');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

/** Extract Set-Cookie headers and format as Cookie header string */
function extractCookies(response) {
  const setCookies = response.headers['set-cookie'] || [];
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

/** Merge old and new cookie strings */
function mergeCookies(existing, newCookies) {
  if (!newCookies) return existing;
  const all = new Map();
  for (const pair of (existing || '').split('; ').filter(Boolean)) {
    const [k, ...v] = pair.split('=');
    all.set(k, v.join('='));
  }
  for (const pair of newCookies.split('; ').filter(Boolean)) {
    const [k, ...v] = pair.split('=');
    all.set(k, v.join('='));
  }
  return [...all.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function run() {
  let cookies = '';

  // 1: Authorize
  const authUrl = `${base}/authorize?` + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'openid profile email', state: 'test',
    code_challenge: challenge, code_challenge_method: 'S256',
  });

  const r1 = await axios.get(authUrl, { maxRedirects: 0, validateStatus: s => true });
  cookies = mergeCookies(cookies, extractCookies(r1));
  console.log('1. Authorize status:', r1.status);

  const loc1 = r1.headers.location || '';
  let flowId;

  if (r1.status === 302 || r1.status === 303) {
    // Follow redirect to PingOne sign-on page to get cookies + flowId
    const r1b = await axios.get(loc1, {
      maxRedirects: 0, validateStatus: s => true,
      headers: { Cookie: cookies },
    });
    cookies = mergeCookies(cookies, extractCookies(r1b));
    try { flowId = new URL(loc1).searchParams.get('flowId'); } catch (e) { /* */ }

    if ((r1b.status === 302 || r1b.status === 303) && r1b.headers.location) {
      const r1c = await axios.get(r1b.headers.location, {
        maxRedirects: 0, validateStatus: s => true,
        headers: { Cookie: cookies },
      });
      cookies = mergeCookies(cookies, extractCookies(r1c));
    }
  }

  console.log('   flowId:', flowId);
  console.log('   Cookies:', cookies.split('; ').map(c => c.split('=')[0]).join(', '));
  if (!flowId) { console.log('FAIL: no flowId'); return; }

  // 2: Submit credentials
  const flowUrl = `https://auth.pingone.com/${envId}/flows/${flowId}`;
  const r2 = await axios.post(flowUrl, { username, password }, {
    headers: {
      'Content-Type': 'application/vnd.pingidentity.usernamePassword.check+json',
      Cookie: cookies,
    },
    validateStatus: s => true,
  });
  cookies = mergeCookies(cookies, extractCookies(r2));
  console.log('2. Cred submit status:', r2.status, 'flow:', r2.data?.status);

  // 3: Resume
  const resumeUrl = `${base}/resume?flowId=${flowId}`;
  const r3 = await axios.get(resumeUrl, {
    maxRedirects: 0, validateStatus: s => true,
    headers: { Cookie: cookies },
  });
  console.log('3. Resume status:', r3.status);
  const loc3 = r3.headers.location || '';
  console.log('   Location:', loc3.slice(0, 200));

  let code, error;
  if (loc3) {
    const u = new URL(loc3);
    code = u.searchParams.get('code');
    error = u.searchParams.get('error');
  }
  if (error) { console.log('   ERROR:', decodeURIComponent(error).slice(0, 300)); return; }
  if (!code) { console.log('FAIL: no authorization code'); return; }
  console.log('   code:', code.slice(0, 30) + '...');

  // 4: Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    code_verifier: verifier, client_id: clientId,
  });
  const r4 = await axios.post(`${base}/token`, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
  });
  console.log('4. TOKEN SUCCESS');
  console.log('   keys:', Object.keys(r4.data).join(', '));
  const p = JSON.parse(Buffer.from(r4.data.access_token.split('.')[1], 'base64url').toString());
  console.log('   sub:', p.sub, 'aud:', p.aud, 'scope:', p.scope);
  if (r4.data.id_token) {
    const ip = JSON.parse(Buffer.from(r4.data.id_token.split('.')[1], 'base64url').toString());
    console.log('   id_token sub:', ip.sub);
  }
}

run().catch(e => {
  console.log('FAIL:', e.response?.status, e.response?.data || e.message);
});
