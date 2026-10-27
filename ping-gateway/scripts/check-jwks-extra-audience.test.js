#!/usr/bin/env node
/**
 * jwks-token-validation.groovy accepts an OPTIONAL extra audience and extra scope.
 *
 * Why: an Agent Privilege app in front of this gateway can only pass a token that carries
 * the audience Privilege generated for the caller's identity, and PingOne will not let one
 * app hold the same scope name on two resources, so that caller cannot also carry this
 * gateway's own audience and scope. PG_JWKS_EXTRA_AUDIENCES / PG_JWKS_EXTRA_SCOPES add
 * exact-match allowances for that path. They default to empty, which must leave the checks
 * exactly as they were. These are static checks (the script runs inside PingGateway); the live
 * proof is a request through the gateway with the extra values set.
 *
 * Run: node --test ping-gateway/scripts/check-jwks-extra-audience.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const groovy = fs.readFileSync(path.join(__dirname, 'groovy', 'jwks-token-validation.groovy'), 'utf8');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

test('the extras are read from their own env names and default to empty lists', () => {
  assert.match(groovy, /def extraAudiences\s*=\s*csv\('PG_JWKS_EXTRA_AUDIENCES'\)/);
  assert.match(groovy, /def extraScopes\s*=\s*csv\('PG_JWKS_EXTRA_SCOPES'\)/);
  // unset -> '' -> no tokens -> []
  assert.match(groovy, /\(System\.getenv\(name\) \?: ''\)\.tokenize\(','\)/);
  assert.match(groovy, /\.findAll \{ it \}/, 'blank entries are dropped, so an empty value allows nothing');
});

test('the audience check still requires a non-empty aud and only adds exact matches', () => {
  const line = groovy.split('\n').find((l) => l.startsWith('def audOk'));
  assert.ok(line, 'audOk line exists');
  assert.match(line, /audList\.any \{ it && \(it == gatewayResourceUri \|\| it == gatewayResourceId \|\| extraAudiences\.contains\(it\)\) \}/);
});

test('the scope check keeps the required scope and only adds exact matches', () => {
  const line = groovy.split('\n').find((l) => l.includes("deny('insufficient_scope')"));
  assert.ok(line);
  assert.match(line, /!scopes\.contains\(requiredScope\) && !scopes\.any \{ extraScopes\.contains\(it\) \}/);
});

test('the fail-closed audience config guard is untouched', () => {
  assert.match(groovy, /if \(!gatewayResourceUri && !gatewayResourceId\) return deny\('aud_config_missing'\)/);
});

test('both settings are documented in .env.example, commented out', () => {
  assert.match(envExample, /^# PG_JWKS_EXTRA_AUDIENCES=/m);
  assert.match(envExample, /^# PG_JWKS_EXTRA_SCOPES=/m);
});
