import { redirectUriIsRegistered } from '../OAuthRouter';

// RFC 8252 §7.3 — a native app registers one loopback port and then listens on
// whatever is free, so the port must not take part in the comparison. LM Studio
// picks a fresh port every launch; exact matching gave it
// "400 redirect_uri not registered" on its second run (observed 2026-09-02).
describe('redirectUriIsRegistered', () => {
  const registered = ['http://127.0.0.1:33389/mcp-oauth-callback'];

  test('accepts the exact registered URI', () => {
    expect(redirectUriIsRegistered(registered, 'http://127.0.0.1:33389/mcp-oauth-callback')).toBe(true);
  });

  test('accepts the same loopback path on a different port', () => {
    expect(redirectUriIsRegistered(registered, 'http://127.0.0.1:41999/mcp-oauth-callback')).toBe(true);
  });

  test('still requires the path to match', () => {
    expect(redirectUriIsRegistered(registered, 'http://127.0.0.1:41999/somewhere-else')).toBe(false);
  });

  test('does not treat a remote host as loopback', () => {
    expect(redirectUriIsRegistered(registered, 'http://evil.example.com:33389/mcp-oauth-callback')).toBe(false);
  });

  test('does not let a loopback request match a remote registration', () => {
    expect(
      redirectUriIsRegistered(['https://app.example.com/cb'], 'http://127.0.0.1:41999/cb'),
    ).toBe(false);
  });

  test('keeps exact matching for non-loopback redirects', () => {
    const remote = ['https://app.example.com/cb'];
    expect(redirectUriIsRegistered(remote, 'https://app.example.com/cb')).toBe(true);
    expect(redirectUriIsRegistered(remote, 'https://app.example.com:8443/cb')).toBe(false);
  });

  test('ignores unparseable input instead of throwing', () => {
    expect(redirectUriIsRegistered(registered, 'not a url')).toBe(false);
  });
});
