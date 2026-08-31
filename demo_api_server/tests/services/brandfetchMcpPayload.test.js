'use strict';

// Covers the only genuinely new logic in services/brandfetch.js after the move
// from the REST Brand API to the MCP door: SSE framing, the double-encoded brand
// payload, and isError (which arrives on a 200 and so cannot be inferred from
// HTTP status). The colour/logo/font picking below it is unchanged from the REST
// implementation and is exercised through fetchBrand's happy path.

const { parseMcpBrandPayload, fetchBrand } = require('../../services/brandfetch');

const BRAND = {
  colors: [
    { hex: '#000000', type: 'dark', brightness: 0 },
    { hex: '#ff6600', type: 'accent', brightness: 140 },
  ],
  logos: [
    { theme: 'dark', type: 'logo', formats: [{ src: 'https://cdn.brandfetch.io/x/logo.svg', format: 'svg' }] },
  ],
  fonts: [
    { name: 'Proxima Nova', type: 'body' },
    { name: 'Gilroy', type: 'title' },
  ],
};

const sse = (obj) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`;
const ok = (brand) => sse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(brand) }], isError: false } });

describe('parseMcpBrandPayload', () => {
  test('unwraps SSE framing and the double-encoded brand JSON', () => {
    expect(parseMcpBrandPayload(ok(BRAND))).toEqual(BRAND);
  });

  test('accepts a bare JSON body too (no SSE framing)', () => {
    const body = JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(BRAND) }] } });
    expect(parseMcpBrandPayload(body)).toEqual(BRAND);
  });

  test('isError with an unknown domain maps to 404, not 502', () => {
    const body = sse({ result: { content: [{ type: 'text', text: 'No brand found for nope.invalid' }], isError: true } });
    expect(() => parseMcpBrandPayload(body)).toThrow(/No brand found/);
    try {
      parseMcpBrandPayload(body);
    } catch (e) {
      expect(e.status).toBe(404);
    }
  });

  test('isError for any other tool failure maps to 502', () => {
    const body = sse({ result: { content: [{ type: 'text', text: 'upstream exploded' }], isError: true } });
    try {
      parseMcpBrandPayload(body);
    } catch (e) {
      expect(e.status).toBe(502);
    }
  });

  test('a JSON-RPC error envelope is a 502', () => {
    const body = sse({ error: { code: -32602, message: 'bad params' } });
    try {
      parseMcpBrandPayload(body);
    } catch (e) {
      expect(e.status).toBe(502);
      expect(e.message).toMatch(/bad params/);
    }
  });

  test('malformed inner JSON is a 502, not a crash', () => {
    const body = sse({ result: { content: [{ type: 'text', text: '{not json' }] } });
    expect(() => parseMcpBrandPayload(body)).toThrow(/malformed brand JSON/);
  });

  test('unparseable body is a 502, not a crash', () => {
    expect(() => parseMcpBrandPayload('not an envelope at all')).toThrow(/unparseable/);
  });
});

describe('fetchBrand', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.BRANDFETCH_MCP_TOKEN;
  });

  test('501 when the MCP token is not configured', async () => {
    delete process.env.BRANDFETCH_MCP_TOKEN;
    await expect(fetchBrand('ping.com')).rejects.toMatchObject({ status: 501 });
  });

  test('calls get_brand over MCP and reduces the payload to theme ingredients', async () => {
    process.env.BRANDFETCH_MCP_TOKEN = 'test-token';
    let seen = null;
    global.fetch = jest.fn(async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, text: async () => ok(BRAND) };
    });

    const out = await fetchBrand('ping.com');

    expect(seen.url).toBe('https://mcp.brandfetch.io/mcp');
    expect(seen.init.headers.Authorization).toBe('Bearer test-token');
    // Without this Accept the door rejects the request outright.
    expect(seen.init.headers.Accept).toMatch(/text\/event-stream/);
    const body = JSON.parse(seen.init.body);
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'get_brand', arguments: { identifier: 'ping.com' } });

    // dark wins over accent by COLOR_PRIORITY; title font wins over body.
    expect(out).toEqual({
      logoPath: 'https://cdn.brandfetch.io/x/logo.svg',
      primary: '#000000',
      accent: '#ff6600',
      fontName: 'Gilroy',
    });
  });

  test('a non-200 from the door is a 502', async () => {
    process.env.BRANDFETCH_MCP_TOKEN = 'test-token';
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, text: async () => '' }));
    await expect(fetchBrand('ping.com')).rejects.toMatchObject({ status: 502 });
  });

  test('never falls back to the leaked REST key', async () => {
    // The REST key is public in git history and unrotatable; a fallback would put
    // it back on the wire. Absence of the MCP token must fail, not degrade.
    delete process.env.BRANDFETCH_MCP_TOKEN;
    process.env.BRANDFETCH_API_KEY = 'leaked-rest-key';
    global.fetch = jest.fn();
    await expect(fetchBrand('ping.com')).rejects.toMatchObject({ status: 501 });
    expect(global.fetch).not.toHaveBeenCalled();
    delete process.env.BRANDFETCH_API_KEY;
  });
});
