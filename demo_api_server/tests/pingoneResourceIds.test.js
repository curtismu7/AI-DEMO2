'use strict';

/**
 * PINGONE_RESOURCE_IDS closes the last gap in id-first resolution.
 *
 * findObject() has always preferred id → audience → name, but nothing ever wrote
 * an id, so it could only ever start at step 2. resolveResourcesByAudience() in
 * refresh-service-envs.js existed and captured ids — and was never called.
 *
 * The case that matters: the manifest audience is WRONG (exactly the
 * `Demo MCP Invest` drift) and the id still resolves the right object.
 */

jest.mock('../services/scopeTopology', () => ({
  _manifest: () => ({ provisioning: { resourceNames: {}, appNames: {} } }),
  resourceScopes: () => [],
  appGrantedScopes: () => [],
}));

/**
 * Fresh objects per service. createResourceServer() normalises a returned
 * resource's `audience` from string to array IN PLACE, so a shared fixture gets
 * mutated by the first test and every later audience comparison silently misses.
 * Production is unaffected — each call re-fetches from the API.
 */
const makeResources = () => [
  { id: 'id-invest', name: 'Demo MCP Invest', audience: 'mcp-invest.ping.demo' },
  { id: 'id-api', name: 'Demo API', audience: 'enduser.ping.demo' },
];

function makeService() {
  const RESOURCES = makeResources();
  const mod = require('../services/pingoneProvisionService');
  const Ctor = mod.PingOneProvisionService;
  const svc = Object.create(Ctor.prototype);
  svc.calls = [];
  svc.makeRequest = jest.fn(async (method, url) => {
    svc.calls.push(`${method} ${url}`);
    const byId = url.match(/^\/resources\/([\w-]+)$/);
    if (byId) {
      const found = RESOURCES.find((r) => r.id === byId[1]);
      if (!found) throw new Error('404');
      return { data: found };
    }
    if (method === 'POST') throw new Error('POST should not happen — that is the duplicate');
    return { data: { _embedded: { resources: RESOURCES } } };
  });
  return svc;
}

describe('PINGONE_RESOURCE_IDS', () => {
  const prev = process.env.PINGONE_RESOURCE_IDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.PINGONE_RESOURCE_IDS;
    else process.env.PINGONE_RESOURCE_IDS = prev;
    jest.resetModules();
  });

  it('resolves by id with a direct GET, skipping the listing entirely', async () => {
    process.env.PINGONE_RESOURCE_IDS = JSON.stringify({ 'mcp-invest.ping.demo': 'id-invest' });
    const svc = makeService();
    const res = await svc.createResourceServer('Demo MCP Invest', 'd', 'mcp-invest.ping.demo');
    expect(res.exists).toBe(true);
    expect(res.resource.id).toBe('id-invest');
    expect(svc.calls).toEqual(['GET /resources/id-invest']);
  });

  // The drift case: BOTH the display name and the audience are wrong. Only the id
  // saves this, and without it the caller would POST a duplicate.
  it('still resolves when the manifest audience has drifted', async () => {
    process.env.PINGONE_RESOURCE_IDS = JSON.stringify({ 'mcp-resource-server.ping.demo': 'id-invest' });
    const svc = makeService();
    const res = await svc.createResourceServer(
      'Super Banking MCP Invest',        // stale name
      'd',
      'mcp-resource-server.ping.demo',   // stale audience
    );
    expect(res.resource.id).toBe('id-invest');
    expect(svc.calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('falls back to audience when no id is configured', async () => {
    delete process.env.PINGONE_RESOURCE_IDS;
    const svc = makeService();
    const res = await svc.createResourceServer('anything', 'd', 'enduser.ping.demo');
    expect(res.resource.id).toBe('id-api');
  });

  it('malformed JSON degrades to the audience path instead of throwing', async () => {
    process.env.PINGONE_RESOURCE_IDS = 'not json';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = makeService();
    const res = await svc.createResourceServer('anything', 'd', 'enduser.ping.demo');
    expect(res.resource.id).toBe('id-api');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    warn.mockRestore();
  });

  it('a stale id falls through to audience rather than blocking', async () => {
    process.env.PINGONE_RESOURCE_IDS = JSON.stringify({ 'enduser.ping.demo': 'deleted-id' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = makeService();
    const res = await svc.createResourceServer('Demo API', 'd', 'enduser.ping.demo');
    expect(res.resource.id).toBe('id-api');
    warn.mockRestore();
  });
});
