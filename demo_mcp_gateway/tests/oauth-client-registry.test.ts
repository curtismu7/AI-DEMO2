import { ClientRegistry, InvalidRedirectUriError } from '../src/oauth/ClientRegistry';

describe('ClientRegistry', () => {
  it('registers a client with loopback redirect_uris', () => {
    const registry = new ClientRegistry();
    const client = registry.registerClient({
      client_name: 'LM Studio',
      redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    expect(client.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(registry.getClient(client.client_id)).toEqual(client);
  });

  it('rejects a non-loopback redirect_uri', () => {
    const registry = new ClientRegistry();
    expect(() =>
      registry.registerClient({
        client_name: 'evil',
        redirect_uris: ['https://attacker.example.com/callback'],
      }),
    ).toThrow(InvalidRedirectUriError);
  });

  it('rejects an empty redirect_uris list', () => {
    const registry = new ClientRegistry();
    expect(() =>
      registry.registerClient({ client_name: 'no-redirects', redirect_uris: [] }),
    ).toThrow(InvalidRedirectUriError);
  });

  it('authenticateClient returns the client for token_endpoint_auth_method none with no secret', () => {
    const registry = new ClientRegistry();
    const client = registry.registerClient({
      client_name: 'public client',
      redirect_uris: ['http://localhost:9999/callback'],
    });
    expect(registry.authenticateClient(client.client_id, undefined)).toEqual(client);
  });

  it('authenticateClient returns null for an unknown client_id', () => {
    const registry = new ClientRegistry();
    expect(registry.authenticateClient('unknown-id', undefined)).toBeNull();
  });

  it('adoptClient registers a caller-supplied client_id (post-restart recovery) with the pinned scope', () => {
    const registry = new ClientRegistry();
    const client = registry.adoptClient({ client_id: 'given-by-client', redirect_uris: ['http://localhost:7465/callback'] });
    expect(client.client_id).toBe('given-by-client');
    expect(client.scope).toBe('mcp:invoke');
    expect(registry.getClient('given-by-client')).toEqual(client);
    expect(() => registry.adoptClient({ client_id: 'x', redirect_uris: ['https://attacker.example.com/cb'] })).toThrow(InvalidRedirectUriError);
  });
});
