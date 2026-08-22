import { ClientRegistry, fetchClientIdMetadataDocument } from '../ClientRegistry';

const CIMD_URL = 'https://chatgpt.com/connectors/client-metadata.json';

function mockCimdResponse(doc: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    text: async () => JSON.stringify(doc),
  }) as unknown as typeof fetch;
}

describe('Client ID Metadata Document resolution', () => {
  const ORIG = { ...process.env };
  const REAL_FETCH = global.fetch;

  beforeEach(() => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    delete process.env.CIMD_ALLOWED_HOSTS;
    delete process.env.DCR_OPEN_REGISTRATION_SCOPE;
  });
  afterEach(() => {
    process.env = { ...ORIG };
    global.fetch = REAL_FETCH;
    jest.restoreAllMocks();
  });

  it('resolves a well-formed document into a public client', async () => {
    mockCimdResponse({
      client_id: CIMD_URL,
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      grant_types: ['authorization_code'],
    });

    const client = await fetchClientIdMetadataDocument(CIMD_URL);

    expect(client).toBeDefined();
    expect(client!.client_id).toBe(CIMD_URL);
    expect(client!.client_name).toBe('ChatGPT');
    expect(client!.token_endpoint_auth_method).toBe('none');
    expect(client!.redirect_uris).toEqual(['https://chatgpt.com/connector_platform_oauth_redirect']);
  });

  it('pins the scope server-side rather than reading it from the document', async () => {
    mockCimdResponse({
      client_id: CIMD_URL,
      client_name: 'Greedy',
      redirect_uris: ['https://chatgpt.com/cb'],
      scope: 'admin:read admin:write',
    });

    const client = await fetchClientIdMetadataDocument(CIMD_URL);

    expect(client!.scope).toBe('mcp:invoke read');
  });

  it('rejects a document whose client_id does not match the URL it came from', async () => {
    mockCimdResponse({
      client_id: 'https://evil.example/impersonating.json',
      client_name: 'Impersonator',
      redirect_uris: ['https://evil.example/cb'],
    });

    expect(await fetchClientIdMetadataDocument(CIMD_URL)).toBeUndefined();
  });

  it('refuses a non-https client_id', async () => {
    mockCimdResponse({ client_id: 'http://chatgpt.com/x.json' });
    expect(await fetchClientIdMetadataDocument('http://chatgpt.com/x.json')).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses to fetch loopback and private-network hosts (SSRF)', async () => {
    mockCimdResponse({ client_id: 'https://localhost/x.json' });

    for (const url of [
      'https://localhost/x.json',
      'https://127.0.0.1/x.json',
      'https://10.0.0.5/x.json',
      'https://192.168.1.10/x.json',
      'https://172.16.0.9/x.json',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect(await fetchClientIdMetadataDocument(url)).toBeUndefined();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('honours CIMD_ALLOWED_HOSTS as a strict allowlist when set', async () => {
    process.env.CIMD_ALLOWED_HOSTS = 'chatgpt.com, claude.ai';
    mockCimdResponse({
      client_id: 'https://elsewhere.example/x.json',
      redirect_uris: ['https://elsewhere.example/cb'],
    });

    expect(await fetchClientIdMetadataDocument('https://elsewhere.example/x.json')).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns undefined when the document cannot be fetched', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    expect(await fetchClientIdMetadataDocument(CIMD_URL)).toBeUndefined();
  });

  describe('ClientRegistry.resolveClient', () => {
    it('returns a registered client without any fetch', async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;
      const registry = new ClientRegistry();
      registry.initialize();

      const client = await registry.resolveClient('mcp-inspector');

      expect(client?.client_name).toBe('MCP Inspector (public)');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('resolves and caches a CIMD client so a second call does not refetch', async () => {
      mockCimdResponse({
        client_id: CIMD_URL,
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/cb'],
      });
      const registry = new ClientRegistry();
      registry.initialize();

      expect((await registry.resolveClient(CIMD_URL))?.client_name).toBe('ChatGPT');
      expect((await registry.resolveClient(CIMD_URL))?.client_name).toBe('ChatGPT');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(registry.getClient(CIMD_URL)).toBeDefined();
    });

    it('does not resolve a CIMD client when open registration is off', async () => {
      delete process.env.MCP_OPEN_CLIENT_REGISTRATION;
      mockCimdResponse({ client_id: CIMD_URL, redirect_uris: [] });
      const registry = new ClientRegistry();
      registry.initialize();

      expect(await registry.resolveClient(CIMD_URL)).toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
