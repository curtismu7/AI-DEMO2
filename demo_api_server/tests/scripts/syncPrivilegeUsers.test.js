'use strict';

const { syncPrivilegeUsers } = require('../../scripts/syncPrivilegeUsers');

const SRC = 'src-env';
const DST = 'dst-env';
const env = {
  PINGONE_ENVIRONMENT_ID: SRC,
  PRIVILEGE_CONSOLE_ENV_ID: DST,
  PINGONE_WORKER_CLIENT_ID: 'id',
  PINGONE_WORKER_CLIENT_SECRET: 'secret',
  DEMO_USER_USERNAME: 'alice@example.com',
  DEMO_ADMIN_USERNAME: 'demoAdmin',
};

// Fake PingOne: src/dst user directories, one group, a membership table.
function fakePingOne({ srcUsers, dstUsers, members = [], first404 = false }) {
  const calls = [];
  let pending404 = first404;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const match = (list, filter) => {
    const vals = [...filter.matchAll(/(username|email) eq "([^"]+)"/g)];
    return list.filter((u) => vals.some(([, k, v]) => String(u[k]).toLowerCase() === v.toLowerCase()));
  };
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url.replace(/\?.*/, '')}`);
    if (url.includes('/as/token')) return json({ access_token: 't' });
    const filter = decodeURIComponent((url.split('filter=')[1] || ''));
    if (url.includes('/groups?')) return json({ _embedded: { groups: [{ id: 'g1', name: 'PrivilegeAdmins' }] } });
    if (url.endsWith('/populations')) return json({ _embedded: { populations: [{ id: 'p1', default: true }] } });
    if (method === 'GET' && url.includes(`/${SRC}/users?`)) return json({ _embedded: { users: match(srcUsers, filter) } });
    if (method === 'GET' && url.includes(`/${DST}/users?`)) return json({ _embedded: { users: match(dstUsers, filter) } });
    if (method === 'POST' && url.endsWith(`/${DST}/users`)) {
      const u = { id: `new-${dstUsers.length}`, ...JSON.parse(opts.body) };
      dstUsers.push(u);
      return json(u, 201);
    }
    const m = url.match(/users\/([^/]+)\/memberOfGroups/);
    if (m && method === 'GET') return json({ _embedded: { groupMemberships: members.includes(m[1]) ? [{ id: 'g1' }] : [] } });
    if (m && method === 'POST') {
      if (pending404) { pending404 = false; return json({}, 404); }
      members.push(m[1]);
      return json({}, 201);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls, dstUsers, members };
}

const quiet = () => {};

test('skips when there is no separate Privilege env', async () => {
  const fetchImpl = jest.fn();
  const r = await syncPrivilegeUsers({ env: { ...env, PRIVILEGE_CONSOLE_ENV_ID: SRC }, fetchImpl, log: quiet });
  expect(r.skipped).toBe(true);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('creates a missing demo user in the Privilege env and adds it to the group, retrying a fresh-user 404', async () => {
  const p = fakePingOne({ srcUsers: [{ id: 's1', username: 'alice@example.com', email: 'alice@example.com', name: { given: 'A' } }], dstUsers: [], first404: true });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet, retryDelayMs: 0 });
  expect(r.created).toEqual(['alice@example.com']);
  expect(r.added).toEqual(['alice@example.com']);
  expect(p.dstUsers[0]).toMatchObject({ email: 'alice@example.com', username: 'alice@example.com', population: { id: 'p1' } });
  expect(p.members).toEqual(['new-0']);
});

test('leaves an already-synced user alone', async () => {
  const p = fakePingOne({
    srcUsers: [{ id: 's1', username: 'alice@example.com', email: 'alice@example.com' }],
    dstUsers: [{ id: 'd1', username: 'alice', email: 'alice@example.com' }],
    members: ['d1'],
  });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet });
  expect(r.ok).toEqual(['alice@example.com']);
  expect(p.calls.filter((c) => c.startsWith('POST') && !c.includes('/as/token'))).toEqual([]);
});

test('skips a user whose username another Privilege user already holds (case-insensitive)', async () => {
  const p = fakePingOne({
    srcUsers: [{ id: 's2', username: 'demoAdmin', email: 'demoAdmin@api.ping.demo' }],
    dstUsers: [{ id: 'd9', username: 'demoadmin', email: 'someone.else@example.com' }],
  });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet });
  expect(r.skipped).toEqual(['demoAdmin@api.ping.demo']);
  expect(p.dstUsers).toHaveLength(1);
});

test('adopts a hand-made Privilege user with the same username and no email, and adds it to the group', async () => {
  const p = fakePingOne({
    srcUsers: [{ id: 's2', username: 'demoAdmin', email: 'demoAdmin@api.ping.demo' }],
    dstUsers: [{ id: 'd7', username: 'demoadmin' }],
  });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet });
  expect(r.added).toEqual(['demoAdmin@api.ping.demo']);
  expect(p.dstUsers).toHaveLength(1);
  expect(p.members).toEqual(['d7']);
});

test('dry run writes nothing', async () => {
  const p = fakePingOne({ srcUsers: [{ id: 's1', username: 'alice@example.com', email: 'alice@example.com' }], dstUsers: [] });
  await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet, dryRun: true });
  expect(p.dstUsers).toHaveLength(0);
  expect(p.members).toHaveLength(0);
});
