'use strict';

/**
 * set-airline-member-tier.js against a stubbed fetch: no network, no tenant, no credentials.
 *   node --test scripts/set-airline-member-tier.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { run, parseArgs, filterLiteral } = require('./set-airline-member-tier.js');

const ENV = {
  PINGONE_ENVIRONMENT_ID: 'env-test', PINGONE_REGION: 'NA',
  PINGONE_WORKER_CLIENT_ID: 'worker-test', PINGONE_WORKER_CLIENT_SECRET: 'secret-value-must-never-print',
};

/** A fake PingOne. `state.attrs` / `state.users` are mutated by writes; `calls` records every request. */
function fakePingOne({ attrs = [], users = [{ id: 'user-1', username: 'demouser', airlineMemberTier: 'Premier Gold' }], tokenOk = true, patchOk = true } = {}) {
  const calls = [];
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url, headers: opts.headers || {}, body: opts.body });
    if (url.includes('/as/token')) return tokenOk ? res(200, { access_token: 'tok-must-never-print' }) : res(401, { code: 'invalid_client' });
    if (url.endsWith('/schemas')) return res(200, { _embedded: { schemas: [{ id: 'schema-1', name: 'User' }] } });
    if (url.endsWith('/schemas/schema-1/attributes') && method === 'GET') return res(200, { _embedded: { attributes: attrs } });
    if (url.endsWith('/schemas/schema-1/attributes') && method === 'POST') return res(201, {});
    if (url.includes('/users?filter=')) return res(200, { _embedded: { users } });
    if (url.endsWith('/users/user-1') && method === 'PATCH') return patchOk ? res(200, {}) : res(400, { code: 'INVALID_VALUE', message: 'bad' });
    return res(404, {});
  };
  return { fetchImpl, calls };
}

async function runIt(argv, fake, env = ENV) {
  const out = [];
  const result = await run({ argv, env, fetchImpl: fake.fetchImpl, log: (l) => out.push(l) });
  return { result, out: out.join('\n') };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !c.url.includes('/as/token'));

test('parseArgs: needs exactly a username and a tier; only --apply is an option', () => {
  assert.deepStrictEqual(parseArgs(['demouser', 'Premier Silver']), { apply: false, username: 'demouser', tier: 'Premier Silver' });
  assert.deepStrictEqual(parseArgs(['demouser', 'Premier Silver', '--apply']).apply, true);
  for (const bad of [[], ['u'], ['u', 't', 'x'], ['u', '  '], ['  ', 't'], ['u', 't', '--force'], ['u', 'x'.repeat(101)]]) {
    assert.throws(() => parseArgs(bad), /usage|empty|unknown|longer/, JSON.stringify(bad));
  }
});

test('filterLiteral escapes quotes and backslashes', () => {
  assert.strictEqual(filterLiteral('a"b\\c'), '"a\\"b\\\\c"');
});

test('DRY RUN is the default: reads only, no write of any kind, says what it would do', async () => {
  const fake = fakePingOne({ attrs: [] });
  const { result, out } = await runIt(['demouser', 'Premier Silver'], fake);
  assert.strictEqual(writes(fake.calls).length, 0, 'a dry run must not POST or PATCH');
  assert.deepStrictEqual(result, { changed: false, dryRun: true });
  assert.match(out, /DRY RUN/);
  assert.match(out, /airlineMemberTier: MISSING - would create it/);
  assert.match(out, /would set airlineMemberTier = "Premier Silver"/);
});

test('--apply creates the missing attribute, then PATCHes the one user (attribute name airlineMemberTier)', async () => {
  const fake = fakePingOne({ attrs: [] });
  const { result } = await runIt(['demouser', 'Premier Silver', '--apply'], fake);
  assert.deepStrictEqual(result, { changed: true });
  const w = writes(fake.calls);
  assert.deepStrictEqual(w.map((c) => c.method), ['POST', 'PATCH']);
  const created = JSON.parse(w[0].body);
  assert.strictEqual(created.name, 'airlineMemberTier');
  assert.strictEqual(created.type, 'STRING');
  assert.strictEqual(created.required, false);
  assert.ok(w[0].url.endsWith('/schemas/schema-1/attributes'));
  assert.ok(w[1].url.endsWith('/users/user-1'));
  assert.deepStrictEqual(JSON.parse(w[1].body), { airlineMemberTier: 'Premier Silver' });
});

test('--apply with an existing attribute does not create it, and skips the write when the value already matches', async () => {
  const fake = fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }] });
  const { result, out } = await runIt(['demouser', 'Premier Gold', '--apply'], fake);
  assert.deepStrictEqual(result, { changed: false });
  assert.strictEqual(writes(fake.calls).length, 0);
  assert.match(out, /already "Premier Gold"/);
  const fake2 = fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }] });
  await runIt(['demouser', 'Premier Silver', '--apply'], fake2);
  assert.deepStrictEqual(writes(fake2.calls).map((c) => c.method), ['PATCH'], 'no attribute POST when it exists');
});

test('looks the user up by an escaped username filter', async () => {
  const fake = fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }] });
  await runIt(['de"mo', 'Premier Silver'], fake);
  const lookup = fake.calls.find((c) => c.url.includes('/users?filter='));
  assert.strictEqual(decodeURIComponent(lookup.url.split('filter=')[1]), 'username eq "de\\"mo"');
});

test('refuses: attribute of the wrong type, no user, several users, bad credentials, missing config, unknown region', async () => {
  await assert.rejects(runIt(['u', 't', '--apply'], fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'JSON' }] })), /not STRING/);
  await assert.rejects(runIt(['u', 't'], fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }], users: [] })), /no PingOne user/);
  await assert.rejects(runIt(['u', 't'], fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }], users: [{ id: 'a' }, { id: 'b' }] })), /2 users match/);
  await assert.rejects(runIt(['u', 't'], fakePingOne({ tokenOk: false })), /worker token request failed \(HTTP 401\)/);
  await assert.rejects(runIt(['u', 't'], fakePingOne(), { ...ENV, PINGONE_WORKER_CLIENT_SECRET: '' }), /missing PINGONE_ENVIRONMENT_ID/);
  await assert.rejects(runIt(['u', 't'], fakePingOne(), { ...ENV, PINGONE_REGION: 'MARS' }), /unknown PINGONE_REGION/);
  await assert.rejects(runIt(['demouser', 'x', '--apply'], fakePingOne({ attrs: [{ name: 'airlineMemberTier', type: 'STRING' }], patchOk: false })), /updating the user failed \(HTTP 400\) - INVALID_VALUE: bad/);
});

test('never prints the secret or the token, on success or on failure', async () => {
  const fake = fakePingOne({ attrs: [] });
  const { out } = await runIt(['demouser', 'Premier Silver', '--apply'], fake);
  assert.ok(!out.includes('secret-value-must-never-print') && !out.includes('tok-must-never-print'));
  try { await runIt(['demouser', 'x'], fakePingOne({ tokenOk: false })); } catch (e) {
    assert.ok(!e.message.includes('secret-value-must-never-print'));
  }
});
