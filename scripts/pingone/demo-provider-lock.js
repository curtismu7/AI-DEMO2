#!/usr/bin/env node
/**
 * demo:provider-lock — single source of intent for the BFF OAuth provider.
 *
 * The 2026-09-26 incident: two sessions flipped the login provider against
 * each other (one via demo_api_server/.env, one via docker-compose
 * `environment:`, one via the admin toggle), each silently undoing the
 * other. PF-issued tokens carry no `act` claim, so every flip also broke
 * the A2A chain (`a2a_unauthorized`, act depth 0) and every banking demo.
 *
 * Usage:
 *   node scripts/pingone/demo-provider-lock.js show      — print intent + live values
 *   node scripts/pingone/demo-provider-lock.js set <p> <reason>
 *                                                        — record a new intended provider
 *   node scripts/pingone/demo-provider-lock.js verify    — exit 1 on any drift (CI/gate-able)
 *
 * The intent file (.demo-provider-intent.json, committed) is the SSOT.
 * Pre-commit reads it to judge whether an OAUTH_PROVIDER edit is deliberate.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const INTENT_PATH = path.join(REPO, '.demo-provider-intent.json');
const ENV_PATH = path.join(REPO, 'demo_api_server', '.env');
const COMPOSE_PATH = path.join(REPO, 'docker-compose.yml');
const VALID = ['pingone', 'pingfederate'];

function readIntent() {
  try {
    return JSON.parse(fs.readFileSync(INTENT_PATH, 'utf8'));
  } catch (e) {
    return { provider: 'pingone', reason: 'default (no intent file)', setBy: 'bootstrap', setAt: null };
  }
}

function envProvider() {
  try {
    const m = fs.readFileSync(ENV_PATH, 'utf8').match(/^OAUTH_PROVIDER=(.*)$/m);
    return m ? m[1].trim() : '(unset)';
  } catch (e) { return '(no .env)'; }
}

function composeProvider() {
  try {
    const s = fs.readFileSync(COMPOSE_PATH, 'utf8');
    const m = s.match(/^\s*OAUTH_PROVIDER:\s*(\S+)/m);
    return m ? m[1].trim() : '(unset)';
  } catch (e) { return '(no compose)'; }
}

function show() {
  const intent = readIntent();
  console.log('intent.provider    = ' + intent.provider + '  (by ' + intent.setBy + ' at ' + (intent.setAt || '?') + ')');
  console.log('intent.reason      = ' + intent.reason);
  console.log('.env               = ' + envProvider());
  console.log('docker-compose env = ' + composeProvider());
  const drift = [];
  if (envProvider() !== intent.provider && envProvider() !== '(unset)') drift.push('.env');
  if (composeProvider() !== intent.provider && composeProvider() !== '(unset)') drift.push('docker-compose');
  if (drift.length) {
    console.log('DRIFT: ' + drift.join(', ') + ' override the intent - deliberate? update the intent file.');
  } else {
    console.log('no drift');
  }
  return drift;
}

function set(provider, reason) {
  if (!VALID.includes(provider)) {
    console.error('provider must be one of: ' + VALID.join(', '));
    process.exit(1);
  }
  const intent = {
    provider,
    reason: reason || '(no reason given)',
    setBy: process.env.USER || 'unknown',
    setAt: new Date().toISOString(),
  };
  fs.writeFileSync(INTENT_PATH, JSON.stringify(intent, null, 2) + '\n');
  console.log('intent recorded: ' + provider + ' - ' + intent.reason);
  show();
}

function verify() {
  const drift = show();
  if (drift.length) {
    console.error('PROVIDER DRIFT - align .env / docker-compose with the intent file, or update the intent.');
    process.exit(1);
  }
  console.log('provider lock verified.');
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === 'show' || !cmd) { show(); process.exit(0); }
if (cmd === 'set') { set(argv[1], argv.slice(2).join(' ')); process.exit(0); }
if (cmd === 'verify') { verify(); process.exit(0); }
console.error('usage: demo-provider-lock.js [show|set <provider> <reason>|verify]');
process.exit(1);
