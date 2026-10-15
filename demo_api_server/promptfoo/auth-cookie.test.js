'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cookieHeader, parseEnvFile, afterCredentials } = require('./auth-cookie');

test('cookieHeader joins name=value pairs for the target host only', () => {
  const cookies = [
    { name: 'connect.sid', value: 's%3Aabc', domain: 'local.ping-devops.com' },
    { name: '_auth', value: 'xyz', domain: '.ping-devops.com' },
    { name: 'tracker', value: 'no', domain: 'nr-data.net' },
  ];
  assert.strictEqual(cookieHeader(cookies, 'https://local.ping-devops.com:4000'), 'connect.sid=s%3Aabc; _auth=xyz');
});

test('cookieHeader throws when there is no session cookie, so a bad login never runs the eval unauthenticated', () => {
  assert.throws(() => cookieHeader([{ name: '_auth', value: 'x', domain: 'local.ping-devops.com' }], 'https://local.ping-devops.com:4000'), /connect\.sid/);
});

test('parseEnvFile reads KEY=VALUE, skips comments, strips quotes, never overrides existing env', () => {
  const env = { KEEP: 'shell' };
  parseEnvFile('# c\nA=1\nB="two"\nKEEP=file\n\nC=\'3\'\n', env);
  assert.deepStrictEqual(env, { KEEP: 'shell', A: '1', B: 'two', C: '3' });
});

test('afterCredentials: a redirectTo finishes the login', () => {
  assert.strictEqual(afterCredentials(200, { redirectTo: '/api/auth/oauth/user/callback?code=x' }), '/api/auth/oauth/user/callback?code=x');
});

test('afterCredentials: an MFA/device/otp/passkey step cannot be automated and says which', () => {
  for (const step of ['otp', 'device', 'passkey']) {
    assert.throws(() => afterCredentials(200, { step }), new RegExp(`"${step}"`));
  }
});

test('afterCredentials: rejected credentials and a not-started flow are reported plainly', () => {
  assert.throws(() => afterCredentials(401, { message: 'Username or password is incorrect.' }), /incorrect/);
  assert.throws(() => afterCredentials(409, { error: 'pi_flow_not_started' }), /pi_flow_not_started/);
});
