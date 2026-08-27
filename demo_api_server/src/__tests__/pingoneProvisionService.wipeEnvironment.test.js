/**
 * @file pingoneProvisionService.wipeEnvironment.test.js
 *
 * wipeEnvironment had zero test coverage before this. Its 5 delete loops
 * were converted from sequential for-of loops to a bounded-concurrency
 * (_mapLimit, cap 5) worker pool to cut wall-clock time on a reset. This
 * suite locks in: (1) the ownership filter and summary counts are still
 * correct under concurrency, (2) a per-item failure doesn't abort the rest
 * of its category, and (3) _mapLimit itself drains every item — the thing
 * most likely to have an off-by-one bug in a hand-rolled worker pool.
 */
'use strict';

const { PingOneProvisionService } = require('../../services/pingoneProvisionService');

jest.mock('../../services/groupPolicy', () => ({
  listAllVerticalGroupDefinitions: () => [],
}), { virtual: true });

function buildSvc() {
  const svc = new PingOneProvisionService();
  svc.config = { environmentId: 'test-env', region: 'com' };
  svc.initialize = jest.fn().mockResolvedValue(undefined);
  return svc;
}

describe('PingOneProvisionService.wipeEnvironment', () => {
  let svc;

  beforeEach(() => {
    svc = buildSvc();
  });

  it('deletes only owned apps/resources/groups, preserves the worker, and reports accurate counts', async () => {
    const config = { envId: 'env-1', workerClientId: 'worker-1', workerClientSecret: 's', region: 'com' };
    const deletedIds = [];
    svc.makeRequest = jest.fn(async (method, path) => {
      if (method === 'GET' && path === '/applications') {
        return {
          data: {
            _embedded: {
              applications: [
                { id: 'worker-1', name: 'Worker App' },
                { id: 'app-demo-1', name: 'Demo Admin' },
                { id: 'app-other', name: 'Unrelated App' },
              ],
            },
          },
        };
      }
      if (method === 'GET' && path === '/resources') {
        return { data: { _embedded: { resources: [{ id: 'res-demo-1', name: 'Demo Resource' }, { id: 'res-other', name: 'Other Resource' }] } } };
      }
      if (method === 'GET' && path === '/groups') {
        return { data: { _embedded: { groups: [] } } };
      }
      if (method === 'GET' && path === '/schemas?filter=name eq "User"') {
        return { data: { _embedded: { schemas: [{ id: 'schema-1' }] } } };
      }
      if (method === 'GET' && path === '/schemas/schema-1/attributes') {
        return { data: { _embedded: { attributes: [] } } };
      }
      if (method === 'GET' && String(path).startsWith('/users?filter=')) {
        return { data: { _embedded: { users: [] } } };
      }
      if (method === 'DELETE') {
        deletedIds.push(path);
        return { data: {} };
      }
      return { data: {} };
    });

    const summary = await svc.wipeEnvironment(config);

    expect(deletedIds.sort()).toEqual(['/applications/app-demo-1', '/resources/res-demo-1']);
    expect(summary.deleted).toEqual({ apps: 1, resources: 1, groups: 0, attrs: 0, users: 0 });
    expect(summary.skipped.apps).toBe(2); // worker + unrelated app
    expect(summary.skipped.resources).toBe(1); // unrelated resource
    expect(summary.failed).toEqual([]);
  });

  it('records a failed delete without aborting the rest of that category', async () => {
    const config = { envId: 'env-1', workerClientId: 'worker-1', workerClientSecret: 's', region: 'com' };
    svc.makeRequest = jest.fn(async (method, path) => {
      if (method === 'GET' && path === '/applications') {
        return {
          data: {
            _embedded: {
              applications: [
                { id: 'app-demo-1', name: 'Demo One' },
                { id: 'app-demo-2', name: 'Demo Two' },
              ],
            },
          },
        };
      }
      if (method === 'GET' && path === '/resources') return { data: { _embedded: { resources: [] } } };
      if (method === 'GET' && path === '/groups') return { data: { _embedded: { groups: [] } } };
      if (method === 'GET' && path === '/schemas?filter=name eq "User"') return { data: { _embedded: { schemas: [] } } };
      if (method === 'GET' && String(path).startsWith('/users?filter=')) return { data: { _embedded: { users: [] } } };
      if (method === 'DELETE' && path === '/applications/app-demo-1') {
        throw new Error('PingOne 500');
      }
      if (method === 'DELETE') return { data: {} };
      return { data: {} };
    });

    const summary = await svc.wipeEnvironment(config);

    expect(summary.deleted.apps).toBe(1); // app-demo-2 still got deleted
    expect(summary.failed).toEqual([
      { kind: 'app', id: 'app-demo-1', name: 'Demo One', error: 'PingOne 500' },
    ]);
  });

  it('_mapLimit drains every item even with more items than the concurrency cap', async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const seen = [];
    const results = await svc._mapLimit(items, 5, async (n) => {
      seen.push(n);
      return n * 2;
    });

    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
    expect(results).toEqual(items.map((n) => n * 2)); // order preserved despite concurrency
  });
});
