#!/usr/bin/env node
'use strict';
/**
 * _getUserRt.js — Phase 0 helper: obtain a fresh end-user refresh token via a self-driven
 * Authorization Code + PKCE flow (separate from the BFF), so offlineRtCheck.js can run.
 *
 *   node _getUserRt.js build              -> prints the authorize URL; saves PKCE to /tmp/_pkce.json
 *   node _getUserRt.js exchange <code>    -> exchanges code; writes the RT to /tmp/_userrt (0600)
 *
 * Reads PingOne user-client creds from demo_api_server/.env. Prints no secrets.
 * Redirect URI: https://localhost:3000/callback (already registered on the Demo User App).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const ENV = process.env.PINGONE_ENVIRONMENT_ID;
const REGION = process.env.PINGONE_REGION || 'com';
const CLIENT_ID = process.env.PINGONE_USER_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_USER_CLIENT_SECRET;
const REDIRECT = 'https://localhost:3000/callback';
const SCOPE = 'openid profile email offline_access';
const AUTH = `https://auth.pingone.${REGION}/${ENV}/as`;
const PKCE_FILE = '/tmp/_pkce.json';
const RT_FILE = '/tmp/_userrt';

const mode = process.argv[2];

if (mode === 'build') {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(PKCE_FILE, JSON.stringify({ verifier, state }), { mode: 0o600 });
  const u = new URL(`${AUTH}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  console.log(u.toString());
} else if (mode === 'exchange') {
  const code = process.argv[3];
  if (!code) { console.error('usage: exchange <code>'); process.exit(2); }
  const { verifier } = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8'));
  (async () => {
    const res = await fetch(`${AUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: verifier,
      }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200 || !body.refresh_token) {
      console.error(`exchange failed HTTP ${res.status} error=${body.error || '?'} desc=${body.error_description || ''}`);
      process.exit(3);
    }
    fs.writeFileSync(RT_FILE, body.refresh_token, { mode: 0o600 });
    console.log(`RT acquired OK (len ${body.refresh_token.length}); scopes="${body.scope || '?'}"; written to ${RT_FILE}`);
  })();
} else {
  console.error('usage: _getUserRt.js build | exchange <code>');
  process.exit(2);
}
