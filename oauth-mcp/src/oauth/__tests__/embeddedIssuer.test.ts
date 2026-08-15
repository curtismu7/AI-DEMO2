import {
  resolveEmbeddedIssuer,
  getEmbeddedSigningKeyManager,
  resetEmbeddedSigningKeyManagerForTests,
} from '../embeddedIssuer';

describe('embeddedIssuer', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    resetEmbeddedSigningKeyManagerForTests();
  });

  describe('resolveEmbeddedIssuer', () => {
    it('defaults to https://localhost:8080 with no env set', () => {
      delete process.env.OAUTH_ISSUER;
      delete process.env.OAUTH_HOSTNAME;
      delete process.env.MCP_SERVER_PORT;
      expect(resolveEmbeddedIssuer()).toBe('https://localhost:8080');
    });

    it('respects OAUTH_ISSUER when set', () => {
      process.env.OAUTH_ISSUER = 'https://mcp.ping.demo';
      expect(resolveEmbeddedIssuer()).toBe('https://mcp.ping.demo');
    });

    it('builds from OAUTH_HOSTNAME + MCP_SERVER_PORT when OAUTH_ISSUER is unset', () => {
      delete process.env.OAUTH_ISSUER;
      process.env.OAUTH_HOSTNAME = 'mcp-server';
      process.env.MCP_SERVER_PORT = '9090';
      expect(resolveEmbeddedIssuer()).toBe('https://mcp-server:9090');
    });
  });

  describe('getEmbeddedSigningKeyManager', () => {
    it('returns the same instance on repeated calls (singleton)', async () => {
      const a = await getEmbeddedSigningKeyManager();
      const b = await getEmbeddedSigningKeyManager();
      expect(a).toBe(b);
    });

    it('returns a manager with a usable public key and kid', async () => {
      const mgr = await getEmbeddedSigningKeyManager();
      expect(mgr.getKid()).toMatch(/^[a-f0-9]{16}$/);
      expect(mgr.getPublicKey()).toBeDefined();
    });

    it('resetEmbeddedSigningKeyManagerForTests forces a fresh instance', async () => {
      const a = await getEmbeddedSigningKeyManager();
      resetEmbeddedSigningKeyManagerForTests();
      const b = await getEmbeddedSigningKeyManager();
      expect(a).not.toBe(b);
    });
  });
});
