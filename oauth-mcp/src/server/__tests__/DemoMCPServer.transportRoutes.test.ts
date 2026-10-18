import { routesToHttpTransport } from '../DemoMCPServer';

// The gate in DemoMCPServer.handleHttpRequest decides what reaches
// HttpMCPTransport. Transport-level tests bypass it, which is how
// /protected/profile shipped with a live 404.
describe('routesToHttpTransport', () => {
  it.each([
    '/mcp',
    '/audit',
    '/protected/profile',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])('routes %s to the HTTP transport', (p) => {
    expect(routesToHttpTransport(p)).toBe(true);
  });

  it.each(['/token', '/protected', '/protected/profile/x', '/.well-known/oauth-protected-resource-unrelated'])(
    'does not route %s', (p) => {
      expect(routesToHttpTransport(p)).toBe(false);
    },
  );
});
