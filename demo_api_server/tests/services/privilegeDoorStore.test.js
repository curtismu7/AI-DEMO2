'use strict';

// The Privilege door store (W8): what discovery writes so that SERVING a door
// never depends on the credential that discovered it.
//
// openEnv is faked with a Map rather than opening real LMDB, deliberately. The
// store keeps ONE key, so two suites writing it concurrently under jest's four
// workers would clobber each other -- and privilegeMcpClient.state.test.js
// asserts on the exact sibling labels /state derives from that key, so the
// damage would land in a different file as an unexplained failure. The LMDB
// binding itself is one shared getDb() call exercised by twenty other stores;
// what is worth pinning here is this module's own logic.

const mockDb = new Map();

jest.mock('../../services/lmdb/openEnv', () => ({
  getDb: () => ({
    get: (k) => mockDb.get(k),
    putSync: (k, v) => { mockDb.set(k, v); return true; },
    removeSync: (k) => mockDb.delete(k),
  }),
}));

const store = require('../../services/lmdb/privilegeDoorStore.lmdb');

const APPS = [
  { name: 'opensearch22', status: 'Ready', frontEndName: null, backends: ['http://a:8080/mcp'], entryPath: '/mcp' },
  { name: 'brave', status: '', frontEndName: 'brave.example:8643', backends: [], entryPath: null },
];

const POLICIES = [
  { name: 'opensearch-tools', spec: { Apps: ['opensearch22'], Principals: ['someone@example.com'] } },
  { name: 'everything', spec: { Apps: ['opensearch22', 'brave'] } },
  { name: 'unrelated', spec: { Apps: ['banking'] } },
];

beforeEach(() => mockDb.clear());

describe('privilegeDoorStore', () => {
  test('nothing discovered yet reads as null, not an empty inventory', () => {
    // The difference matters: null means "fall back to the hardcoded doors",
    // an empty list would mean "the console says there are no apps".
    expect(store.getInventory()).toBeNull();
  });

  test('a saved inventory survives and carries what serving a door needs', () => {
    store.saveInventory({ envId: 'env-1', gatewayOrigin: 'https://gw.example', applications: APPS, policies: POLICIES });

    const got = store.getInventory();
    expect(got.envId).toBe('env-1');
    expect(got.gatewayOrigin).toBe('https://gw.example');
    expect(got.policyCount).toBe(3);
    expect(got.discoveredAt).toEqual(expect.any(Number));
    expect(got.applications.map((a) => a.name)).toEqual(['opensearch22', 'brave']);
    expect(got.applications[0]).toMatchObject({
      name: 'opensearch22',
      status: 'Ready',
      backends: ['http://a:8080/mcp'],
      entryPath: '/mcp',
    });
  });

  test('the console token is never part of what gets written', () => {
    // Belt and braces: saveInventory takes an inventory, and an inventory has
    // never carried the token -- but this is the assertion that would fail if
    // someone widened its input later.
    store.saveInventory({
      envId: 'env-1', applications: APPS, policies: POLICIES, authToken: 'auth_token=secret', console: { authToken: 'secret' },
    });
    expect(JSON.stringify(store.getInventory())).not.toContain('secret');
  });

  test('records which policies MENTION an app, as a heuristic', () => {
    store.saveInventory({ envId: 'env-1', applications: APPS, policies: POLICIES });

    const [openSearch, brave] = store.getInventory().applications;
    expect(openSearch.policies).toEqual(['opensearch-tools', 'everything']);
    expect(brave.policies).toEqual(['everything']);
  });

  test('a policy naming no app leaves every door unmentioned', () => {
    store.saveInventory({ envId: 'env-1', applications: APPS, policies: [{ name: 'empty', spec: {} }] });
    expect(store.getInventory().applications.every((a) => a.policies.length === 0)).toBe(true);
  });

  test('policiesMentioning cannot match on an empty app name', () => {
    // Otherwise '' is a substring of every serialized policy and an unnamed app
    // would come back "mentioned by everything".
    expect(store.policiesMentioning(POLICIES, '')).toEqual([]);
  });

  test('an unserializable policy spec is skipped, not thrown from', () => {
    const cyclic = { name: 'cyclic', spec: {} };
    cyclic.spec.self = cyclic.spec;
    expect(() => store.saveInventory({ envId: 'e', applications: APPS, policies: [cyclic] })).not.toThrow();
    expect(store.getInventory().applications[0].policies).toEqual([]);
  });

  test('a later discovery REPLACES the previous one', () => {
    // An app deleted in the console has to disappear from the picker. Merging
    // would leave a door that 404s and look like a gateway fault.
    store.saveInventory({ envId: 'env-1', applications: APPS, policies: [] });
    store.saveInventory({ envId: 'env-1', applications: [{ name: 'only-this-one' }], policies: [] });

    expect(store.getInventory().applications.map((a) => a.name)).toEqual(['only-this-one']);
  });

  test('an app with no name is dropped rather than stored as a nameless door', () => {
    store.saveInventory({ envId: 'env-1', applications: [{ name: '' }, { status: 'Ready' }, ...APPS], policies: [] });
    expect(store.getInventory().applications.map((a) => a.name)).toEqual(['opensearch22', 'brave']);
  });

  test('clearInventory takes it back to the fallback state', () => {
    store.saveInventory({ envId: 'env-1', applications: APPS, policies: [] });
    store.clearInventory();
    expect(store.getInventory()).toBeNull();
  });
});
