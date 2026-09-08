/**
 * @file mcpProfileStore.test.js
 * @description Unit tests for the Generic MCP Inspector's saved server profiles
 * (default-banking seeding, CRUD, secret masking).
 */

const mcpProfileStore = require('../../services/mcpProfileStore');
const lmdb = require('../../services/lmdb/mcpProfileStore.lmdb');

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

  describe('built-in Privilege-gateway door profiles', () => {
    const DOORS = [
      { id: () => mcpProfileStore.PRIVILEGE_PROFILE_ID, urlSuffix: 'openapi2/mcp' },
      { id: () => mcpProfileStore.PRIVILEGE_OPENSEARCH_PROFILE_ID, urlSuffix: 'opensearch22/mcp' },
      { id: () => mcpProfileStore.PRIVILEGE_BRAVE_PROFILE_ID, urlSuffix: 'mcp-brave-search/mcp' },
      { id: () => mcpProfileStore.PRIVILEGE_GRAFANA_PROFILE_ID, urlSuffix: 'mcp-grafana/mcp' },
    ];

    it.each(DOORS)('$urlSuffix is seeded as transport:privilege, isBuiltIn, pointed at the current gateway', ({ id, urlSuffix }) => {
      const profiles = mcpProfileStore.listProfiles();
      const found = profiles.find((p) => p.id === id());
      expect(found).toMatchObject({ transport: 'privilege', isBuiltIn: true });
      expect(found.url).toBe(`https://mcpgw.ai-demo.ping-devops.com/${urlSuffix}`);
    });

    it.each(DOORS)('$urlSuffix cannot be deleted', ({ id }) => {
      expect(() => mcpProfileStore.deleteProfile(id())).toThrow(/built-in/i);
    });

    it('self-heals a drifted url back to the current gateway on the next call', () => {
      const id = mcpProfileStore.PRIVILEGE_OPENSEARCH_PROFILE_ID;
      const current = lmdb.getProfile(id);
      lmdb.saveProfile(id, { ...current, url: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp' });
      expect(lmdb.getProfile(id).url).toBe('https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp');

      const healed = mcpProfileStore.listProfiles().find((p) => p.id === id);

      expect(healed.url).toBe('https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp');
    });
  });
});
