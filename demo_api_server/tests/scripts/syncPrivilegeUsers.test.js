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
function fakePingOne({ srcUsers, dstUsers, members = [], first404 = false, hasRole = true, grantStatus = 201, privilegeApp = false, noGroup = false, groupCreateStatus = 201, appsStatus = 200, appPages = 1, groupRace = false }) {
  const memberPosts = [];
  const calls = [];
  let tokens = 0;
  const assignments = hasRole ? [{ role: { id: 'r-ida' }, scope: { type: 'ENVIRONMENT', id: DST } }, { role: { id: 'r-ida' }, scope: { type: 'ENVIRONMENT', id: SRC } }] : [];
  let pending404 = first404;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const match = (list, filter) => {
    const vals = [...filter.matchAll(/(username|email) eq "([^"]+)"/g)];
    return list.filter((u) => vals.some(([, k, v]) => String(u[k]).toLowerCase() === v.toLowerCase()));
  };
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url.replace(/\?.*/, '')}`);
    if (url.includes('/as/token')) { tokens++; return json({ access_token: `t${tokens}` }); }
    if (url.endsWith('/v1/roles')) return json({ _embedded: { roles: [{ id: 'r-ida', name: 'Identity Data Admin' }] } });
    if (url.endsWith(`/${SRC}/applications/id/roleAssignments`)) {
      if (method === 'GET') return json({ _embedded: { roleAssignments: assignments } });
      if (grantStatus < 300) assignments.push(JSON.parse(opts.body));
      return json({}, grantStatus);
    }
    const filter = decodeURIComponent((url.split('filter=')[1] || ''));
    if (url.includes('/applications')) {
      if (appsStatus >= 300) return json({ code: 'ACCESS_FAILED' }, appsStatus);
      const pageNo = Number(new URL(url).searchParams.get('page') || 1);
      const last = pageNo >= appPages;
      return json({ _embedded: { applications: last && privilegeApp ? [{ name: 'PingOne Privilege' }] : [{ name: `Other${pageNo}` }] }, _links: last ? {} : { next: { href: `${url.split('?')[0]}?page=${pageNo + 1}` } } });
    }
    if (method === 'POST' && url.endsWith('/groups')) { if (groupRace) { noGroup = false; return json({ code: 'UNIQUENESS_VIOLATION' }, 400); } return json({ id: 'g-new', code: groupCreateStatus < 300 ? undefined : 'ACCESS_FAILED' }, groupCreateStatus); }
    if (url.includes('/groups?')) return json({ _embedded: { groups: noGroup ? [] : [{ id: 'g1', name: 'PrivilegeAdmins' }] } });
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
      memberPosts.push(JSON.parse(opts.body));
      return json({}, 201);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls, dstUsers, members, memberPosts, assignments, tokenCount: () => tokens };
}

const quiet = () => {};

test('skips when there is no separate Privilege env and the demo env has no Privilege app', async () => {
  const p = fakePingOne({ srcUsers: [], dstUsers: [] });
  const r = await syncPrivilegeUsers({ env: { ...env, PRIVILEGE_CONSOLE_ENV_ID: SRC }, fetchImpl: p.fetchImpl, log: quiet });
  expect(r.skipped).toBe(true);
  expect(p.calls.filter((c) => c.startsWith('POST') && !c.includes('/as/token'))).toEqual([]);
});

test('skips without calling PingOne when no separate env is set and the worker credentials are missing', async () => {
  const fetchImpl = jest.fn();
  const r = await syncPrivilegeUsers({ env: { PINGONE_ENVIRONMENT_ID: SRC }, fetchImpl, log: quiet });
  expect(r.skipped).toBe(true);
  expect(fetchImpl).not.toHaveBeenCalled();
});

describe('one-environment setup (Privilege added to the demo env itself)', () => {
  const oneEnv = { ...env, PRIVILEGE_CONSOLE_ENV_ID: undefined };
  const alice = { id: 's1', username: 'alice@example.com', email: 'alice@example.com' };

  test('creates PrivilegeAdmins when missing and adds the demo accounts, creating no users', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, noGroup: true });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.created).toEqual([]);
    expect(r.added).toEqual(['alice@example.com']);
    expect(p.members).toEqual(['s1']);
    expect(p.memberPosts).toEqual([{ id: 'g-new' }]); // the membership carries the id of the group just created
    expect(p.calls).toContain(`POST https://api.pingone.com/v1/environments/${SRC}/groups`);
  });

  test('finds the Privilege app on a later page of applications', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, appPages: 3 });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.added).toEqual(['alice@example.com']);
  });

  test('an applications lookup that fails skips quietly instead of throwing', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, appsStatus: 403 });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.skipped).toBe(true);
  });

  test('a refused worker token skips quietly when there is no separate env', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl, log: quiet });
    expect(r.skipped).toBe(true);
  });

  test('a group created by a parallel run is found instead of failing', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, noGroup: true, groupRace: true });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.added).toEqual(['alice@example.com']);
    expect(p.memberPosts).toEqual([{ id: 'g1' }]);
  });

  test('the demo account itself is added even when another user shares its email', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true });
    const real = p.fetchImpl;
    // the shared directory also holds a second user with the same email, listed first
    const twin = { id: 'twin', username: 'other', email: 'alice@example.com' };
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: async (u, o) => (o?.method || 'GET') === 'GET' && u.includes(`/${SRC}/users?`) && decodeURIComponent(u.split('filter=')[1] || '').startsWith('email eq') ? { ok: true, status: 200, json: async () => ({ _embedded: { users: [twin, alice] } }) } : real(u, o), log: quiet });
    expect(r.added).toEqual(['alice@example.com']);
    expect(p.members).toEqual(['s1']);
  });

  test('uses the existing group and is a no-op the second time', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, members: ['s1'] });
    const r = await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.ok).toEqual(['alice@example.com']);
    expect(p.calls.filter((c) => c.startsWith('POST') && !c.includes('/as/token'))).toEqual([]);
  });

  test('also works when PRIVILEGE_CONSOLE_ENV_ID equals the demo env', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true });
    const r = await syncPrivilegeUsers({ env: { ...env, PRIVILEGE_CONSOLE_ENV_ID: SRC }, fetchImpl: p.fetchImpl, log: quiet });
    expect(r.added).toEqual(['alice@example.com']);
  });

  test('dry run writes nothing, not even the group', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, noGroup: true });
    await syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet, dryRun: true });
    expect(p.calls.filter((c) => c.startsWith('POST') && !c.includes('/as/token'))).toEqual([]);
    expect(p.members).toHaveLength(0);
  });

  test('a failed group create stops with a clear error', async () => {
    const p = fakePingOne({ srcUsers: [alice], dstUsers: [], privilegeApp: true, noGroup: true, groupCreateStatus: 403 });
    await expect(syncPrivilegeUsers({ env: oneEnv, fetchImpl: p.fetchImpl, log: quiet })).rejects.toThrow(/could not create group PrivilegeAdmins/);
  });
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

test('syncs the extra accounts listed in PRIVILEGE_SYNC_ACCOUNTS', async () => {
  const p = fakePingOne({ srcUsers: [{ id: 's3', username: 'jordan.ellis', email: 'jordan@example.com' }], dstUsers: [] });
  const r = await syncPrivilegeUsers({ env: { ...env, PRIVILEGE_SYNC_ACCOUNTS: ' jordan@example.com , ' }, fetchImpl: p.fetchImpl, log: quiet });
  expect(r.created).toEqual(['jordan@example.com']);
});

test('assigns the worker Identity Data Admin on the Privilege env when missing, then uses a fresh token', async () => {
  const p = fakePingOne({ srcUsers: [], dstUsers: [], hasRole: false });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet, retryDelayMs: 0 });
  expect(r.skipped).toEqual([]);
  expect(p.assignments).toEqual([{ role: { id: 'r-ida' }, scope: { id: DST, type: 'ENVIRONMENT' } }]);
  expect(p.tokenCount()).toBe(2);
});

test('warns and still syncs when the role cannot be assigned', async () => {
  const lines = [];
  const p = fakePingOne({ srcUsers: [{ id: 's1', username: 'alice@example.com', email: 'alice@example.com' }], dstUsers: [], hasRole: false, grantStatus: 403 });
  const r = await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: (l) => lines.push(l), retryDelayMs: 0 });
  expect(lines.join('\n')).toMatch(/HTTP 403.*grant the worker app Identity Data Admin on environment dst-env/);
  expect(r.created).toEqual(['alice@example.com']);
});

test('an organization-scoped role counts and nothing is assigned', async () => {
  const p = fakePingOne({ srcUsers: [], dstUsers: [], hasRole: false });
  p.assignments.push({ role: { id: 'r-ida' }, scope: { type: 'ORGANIZATION', id: 'org' } });
  await syncPrivilegeUsers({ env, fetchImpl: p.fetchImpl, log: quiet });
  expect(p.assignments).toHaveLength(1);
  expect(p.tokenCount()).toBe(1);
});

test('a refused role read does not stop the sync', async () => {
  const p = fakePingOne({ srcUsers: [{ id: 's1', username: 'alice@example.com', email: 'alice@example.com' }], dstUsers: [] });
  const inner = p.fetchImpl;
  const fetchImpl = (url, o) => (url.endsWith('/v1/roles') ? Promise.resolve({ ok: false, status: 403, json: async () => ({}) }) : inner(url, o));
  const r = await syncPrivilegeUsers({ env, fetchImpl, log: quiet, retryDelayMs: 0 });
  expect(r.created).toEqual(['alice@example.com']);
});
