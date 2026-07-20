/**
 * @file mcpProfileStore.test.js
 * @description Unit tests for the Generic MCP Inspector's saved server profiles
 * (default-banking seeding, CRUD, secret masking).
 */

const mcpProfileStore = require('../../services/mcpProfileStore');

describe('mcpProfileStore', () => {
  it('seeds exactly one default banking profile on first list', () => {
    const profiles = mcpProfileStore.listProfiles();
    const defaults = profiles.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(mcpProfileStore.DEFAULT_PROFILE_ID);
    expect(defaults[0].transport).toBe('websocket');
  });

  it('never returns secret fields from listProfiles()', () => {
    mcpProfileStore.createProfile({
      label: 'Secret HTTP server',
      transport: 'http',
      url: 'https://example.test/mcp',
      authHeader: 'Authorization',
      authValue: 'Bearer super-secret-value',
    });
    const profiles = mcpProfileStore.listProfiles();
    const found = profiles.find((p) => p.label === 'Secret HTTP server');
    expect(found).toBeDefined();
    expect(found.authValue).toBeUndefined();
    expect(found.hasAuthValue).toBe(true);
    expect(JSON.stringify(found)).not.toMatch(/super-secret-value/);
  });

  it('createProfile requires a url for http/websocket transport', () => {
    expect(() => mcpProfileStore.createProfile({ label: 'x', transport: 'http' })).toThrow(/url/i);
    expect(() => mcpProfileStore.createProfile({ label: 'x', transport: 'websocket' })).toThrow(/url/i);
  });

  it('createProfile requires a command for stdio transport', () => {
    expect(() => mcpProfileStore.createProfile({ label: 'x', transport: 'stdio' })).toThrow(/command/i);
  });

  it('createProfile rejects an unknown transport', () => {
    expect(() => mcpProfileStore.createProfile({ label: 'x', transport: 'carrier-pigeon', url: 'a' })).toThrow(
      /transport/i
    );
  });

  it('getProfile() (server-side only) returns the full record including secrets', () => {
    const created = mcpProfileStore.createProfile({
      label: 'stdio server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
      env: { BRAVE_API_KEY: 'test-key-value' },
    });
    const full = mcpProfileStore.getProfile(created.id);
    expect(full.command).toBe('npx');
    expect(full.env).toEqual({ BRAVE_API_KEY: 'test-key-value' });
  });

  it('deleteProfile refuses to delete the default banking profile', () => {
    expect(() => mcpProfileStore.deleteProfile(mcpProfileStore.DEFAULT_PROFILE_ID)).toThrow(
      /built-in/i
    );
  });

  it('deleteProfile refuses to delete the built-in PingOne profile', () => {
    expect(() => mcpProfileStore.deleteProfile(mcpProfileStore.PINGONE_PROFILE_ID)).toThrow(
      /built-in/i
    );
  });

  it('deleteProfile removes a non-default profile', () => {
    const created = mcpProfileStore.createProfile({
      label: 'throwaway',
      transport: 'http',
      url: 'https://example.test/mcp2',
    });
    expect(mcpProfileStore.getProfile(created.id)).not.toBeNull();
    mcpProfileStore.deleteProfile(created.id);
    expect(mcpProfileStore.getProfile(created.id)).toBeNull();
  });

  it('deleteProfile throws profile_not_found for an unknown id', () => {
    expect.assertions(1);
    try {
      mcpProfileStore.deleteProfile('does-not-exist');
    } catch (err) {
      expect(err.code).toBe('profile_not_found');
    }
  });
});
