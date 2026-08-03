'use strict';

/**
 * PingOne objects must be resolved by stable identity, not by display name.
 *
 * Matching on a display name means a rename — in the console, or in
 * provisioning.resourceNames — makes the lookup miss and the caller CREATE A
 * DUPLICATE. That is how `Demo MCP Invest` ended up with a manifest audience no
 * live resource carried: twoExchangeReconciler 400'd on every BFF boot for weeks
 * while logging `OK` (2026-08-02).
 *
 * These tests pin the precedence, not the plumbing.
 */

jest.mock('../services/scopeTopology', () => ({
  _manifest: () => ({ provisioning: { resourceNames: {}, appNames: {} } }),
  resourceScopes: () => [],
  appGrantedScopes: () => [],
}));

const { PingOneProvisionService } = (() => {
  const mod = require('../services/pingoneProvisionService');
  return { PingOneProvisionService: mod.PingOneProvisionService || mod };
})();

function makeService(objects, { failIdGet = false } = {}) {
  const svc = Object.create(
    (PingOneProvisionService && PingOneProvisionService.prototype) || Object.prototype,
  );
  svc.calls = [];
  svc.makeRequest = jest.fn(async (method, url) => {
    svc.calls.push(`${method} ${url}`);
    const idMatch = url.match(/^\/(applications|resources)\/([\w-]+)$/);
    if (idMatch) {
      if (failIdGet) throw new Error('404');
      const found = objects.find((o) => o.id === idMatch[2]);
      if (!found) throw new Error('404');
      return { data: found };
    }
    const coll = url.startsWith('/applications') ? 'applications' : 'resources';
    return { data: { _embedded: { [coll]: objects } } };
  });
  return svc;
}

const RESOURCES = [
  { id: 'id-invest', name: 'Demo MCP Invest', audience: 'mcp-invest.ping.demo' },
  { id: 'id-api', name: 'Demo API', audience: 'enduser.ping.demo' },
];

describe('findObject — precedence', () => {
  let warn;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it('resolves by id with a direct GET, without listing', async () => {
    const svc = makeService(RESOURCES);
    const found = await svc.findObject('resource', { id: 'id-invest' });
    expect(found.name).toBe('Demo MCP Invest');
    expect(svc.calls).toEqual(['GET /resources/id-invest']);
  });

  // The property that matters: the display name is WRONG and it still resolves.
  it('resolves by audience even when the name has drifted', async () => {
    const svc = makeService(RESOURCES);
    const found = await svc.findObject('resource', {
      audience: 'mcp-invest.ping.demo',
      name: 'Super Banking MCP Invest',   // stale display name
    });
    expect(found.id).toBe('id-invest');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to name only when no stable key matches, and warns', async () => {
    const svc = makeService(RESOURCES);
    const found = await svc.findObject('resource', {
      audience: 'not-a-real-audience',
      name: 'Demo API',
    });
    expect(found.id).toBe('id-api');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BY NAME'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('id-api'));
  });

  it('a stale id does not block the audience fallback', async () => {
    const svc = makeService(RESOURCES, { failIdGet: true });
    const found = await svc.findObject('resource', {
      id: 'deleted-id',
      audience: 'enduser.ping.demo',
    });
    expect(found.id).toBe('id-api');
  });

  it('returns undefined rather than a wrong object when nothing matches', async () => {
    const svc = makeService(RESOURCES);
    expect(await svc.findObject('resource', { audience: 'nope', name: 'nope' })).toBeUndefined();
  });

  it('applications resolve by clientId ahead of name', async () => {
    const apps = [
      { id: 'app-1', name: 'Demo AI App - User Login' },
      { id: 'app-2', name: 'Demo AI App - Token Exchanger' },
    ];
    const svc = makeService(apps);
    const found = await svc.findObject('application', { clientId: 'app-2', name: 'Demo AI App - User Login' });
    expect(found.id).toBe('app-2');
  });
});

describe('createResourceServer — matches on audience, not display name', () => {
  it('does not create a duplicate when only the display name changed', async () => {
    const svc = makeService(RESOURCES);
    const result = await svc.createResourceServer(
      'AI Demo MCP Invest',            // renamed
      'desc',
      'mcp-invest.ping.demo',          // same audience
    );
    expect(result.exists).toBe(true);
    expect(result.resource.id).toBe('id-invest');
    // The POST that would have created the duplicate must never happen.
    expect(svc.calls.some((c) => c.startsWith('POST'))).toBe(false);
  });
});
