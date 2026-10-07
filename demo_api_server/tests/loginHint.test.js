'use strict';

const { sessionProvider, spelledFor, loginHintFor } = require('../services/loginHint');

const session = (provider, username) => ({ session: { oauthProvider: provider, user: username ? { username } : undefined } });

describe('login_hint spelling', () => {
  test('PingFederate gets its own lowercase spelling of a name from any other session', () => {
    expect(loginHintFor(session('pingone', 'demoUser'), 'pingfederate')).toBe('demouser');
    expect(loginHintFor({ session: { user: { username: 'demoUser' } } }, 'pingfederate')).toBe('demouser');
    expect(loginHintFor(session('pingone_sso', 'demoUser'), 'pingfederate')).toBe('demouser');
  });

  test('a PingFederate session keeps the spelling PingFederate gave it', () => {
    expect(loginHintFor(session('pingfederate', 'MixedCase'), 'pingfederate')).toBe('MixedCase');
  });

  test('PingOne gets the name as it is', () => {
    expect(loginHintFor(session('pingone', 'demoUser'), 'pingone')).toBe('demoUser');
    expect(loginHintFor(session('pingfederate', 'demouser'), 'pingone')).toBe('demouser');
  });

  test('an unknown target is treated as PingOne, never lowercased', () => {
    expect(loginHintFor(session('pingone', 'demoUser'), undefined)).toBe('demoUser');
    expect(loginHintFor(session('pingone', 'demoUser'), 'pingone_sso')).toBe('demoUser');
  });

  test('nobody known means an empty hint, so the caller keeps its default', () => {
    expect(loginHintFor({ session: {} }, 'pingfederate')).toBe('');
    expect(loginHintFor({}, 'pingone')).toBe('');
    expect(loginHintFor(undefined, 'pingone')).toBe('');
    expect(loginHintFor(session('pingone', '   '), 'pingone')).toBe('');
  });

  test('refuses a name that could not be a username', () => {
    expect(loginHintFor(session('pingone', 'bad\nname'), 'pingone')).toBe('');
    expect(loginHintFor(session('pingone', 'x'.repeat(257)), 'pingone')).toBe('');
    expect(loginHintFor(session('pingone', '  demoUser  '), 'pingone')).toBe('demoUser');
  });

  test('takes an explicit name, such as the user the request names', () => {
    expect(loginHintFor(session('pingone', 'other'), 'pingfederate', 'demoUser')).toBe('demouser');
    expect(spelledFor('pingfederate', 'demoUser')).toBe('demouser');
    expect(spelledFor('pingfederate', 'demoUser', 'pingfederate')).toBe('demoUser');
  });

  test('reads the session provider from the session or the stored user', () => {
    expect(sessionProvider({ session: { oauthProvider: 'pingfederate' } })).toBe('pingfederate');
    expect(sessionProvider({ session: { user: { oauthProvider: 'PingFederate' } } })).toBe('pingfederate');
    expect(sessionProvider({ session: { oauthProvider: 'pingone_sso' } })).toBe('pingone');
    expect(sessionProvider({ session: {} })).toBe('');
  });
});
