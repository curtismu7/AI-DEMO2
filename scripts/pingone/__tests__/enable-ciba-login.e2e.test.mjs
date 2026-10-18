// End-to-end through the REAL runEnable code path against an in-memory fake PingOne (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEnable, EMAIL_POLICY, SMS_POLICY } from '../enable-ciba-login.mjs';

const U = '83572007-b2c7-4862-8197-dc225a9fb8e1'; const A = '8a711944-e625-42ce-af14-4d5a0825155a';
const RESTRICTION = { group: { type: 'ANY_GROUP', groups: [{ id: 'g1' }] } };

// Behaves like the real one on what the probe taught: PUT reorders grantTypes and adds server defaults; POST returns an id.
function fakePingOne({ adminRestricted = false, dropOnPut = null, failPostNumber = 0, outDir } = {}) {
  const apps = {
    [U]: { id: U, name: 'Demo AI App - User Login', grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', pkceEnforcement: 'S256_REQUIRED', redirectUris: ['https://x/cb'], clientId: 'cid', updatedAt: 't0', _links: {} },
    [A]: { id: A, name: 'Demo AI App - Admin Login', grantTypes: ['AUTHORIZATION_CODE'], redirectUris: ['https://x/admin'], ...(adminRestricted ? { accessControl: RESTRICTION } : {}) },
  };
  const assigns = { [U]: [{ id: 'old1', flowPolicy: { id: 'some-other' }, priority: 3 }], [A]: [] };
  const log = []; let posts = 0; let seq = 0; const backupBeforeWrite = [];
  const call = async (method, p, body) => {
    log.push({ method, p, body });
    const ok = (j, status = 200) => ({ status, j });
    if (method === 'GET' && p === '/applications') return ok({ _embedded: { applications: Object.values(apps).map(({ id, name }) => ({ id, name })) } });
    if (method === 'GET' && p === '/flowPolicies') return ok({ _embedded: { flowPolicies: [{ id: EMAIL_POLICY, name: 'CIBA - EMAIL' }, { id: SMS_POLICY, name: 'CIBA-SMS' }, { id: 'some-other' }] } });
    let m;
    if (method === 'GET' && (m = p.match(/^\/applications\/([^/]+)$/))) return apps[m[1]] ? ok(structuredClone(apps[m[1]])) : ok({}, 404);
    if (method === 'GET' && (m = p.match(/^\/applications\/([^/]+)\/signOnPolicyAssignments$/))) return ok({ _embedded: { signOnPolicyAssignments: [{ priority: 1 }] } });
    if (method === 'GET' && (m = p.match(/^\/applications\/([^/]+)\/flowPolicyAssignments$/))) return ok({ _embedded: { flowPolicyAssignments: structuredClone(assigns[m[1]]) } });
    if (method === 'PUT' && (m = p.match(/^\/applications\/([^/]+)$/))) {
      backupBeforeWrite.push(fs.readdirSync(outDir).some((f) => f.startsWith(m[1] + '.')));
      const next = { ...body, id: m[1], updatedAt: 't1', hiddenFromAppPortal: false, signing: { algorithm: 'RS256' }, grantTypes: [...body.grantTypes].reverse() };
      if (dropOnPut) delete next[dropOnPut];
      apps[m[1]] = next; return ok(structuredClone(next));
    }
    if (method === 'POST' && (m = p.match(/^\/applications\/([^/]+)\/flowPolicyAssignments$/))) {
      backupBeforeWrite.push(fs.readdirSync(outDir).some((f) => f.startsWith(m[1] + '.')));
      if (++posts === failPostNumber) return ok({ message: 'boom' }, 500);
      const a = { id: `asg-${++seq}-0000-0000-0000`, ...body }; assigns[m[1]].push(a); return ok(a, 201);
    }
    throw new Error(`fake PingOne: unexpected ${method} ${p}`);
  };
  return { call, apps, assigns, log, backupBeforeWrite };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ciba-e2e-'));
let clock = Date.UTC(2026, 9, 17); const now = () => new Date((clock += 1000));
const run = async (fake, out, opts = {}) => { const lines = []; const r = await runEnable({ call: fake.call, out, now, log: (...a) => lines.push(a.join(' ')), ...opts }); return { ...r, text: lines.join('\n') }; };
const writes = (fake) => fake.log.filter((l) => l.method !== 'GET');

test('happy path: dry run writes nothing but a backup; apply adds grant + both policies; second apply is a no-op', async () => {
  const out = tmp(); const fake = fakePingOne({ outDir: out });
  const dry = await run(fake, out, { which: 'user' });
  assert.equal(dry.ops.length, 3); assert.equal(writes(fake).length, 0);
  assert.match(dry.text, /DRY RUN/);
  assert.equal(fs.readdirSync(out).length, 1);

  const r = await run(fake, out, { which: 'user', apply: true });
  assert.equal(r.failed, false);
  assert.deepEqual([...fake.apps[U].grantTypes].sort(), ['AUTHORIZATION_CODE', 'CIBA', 'REFRESH_TOKEN']);
  assert.deepEqual(fake.assigns[U].slice(1).map((a) => [a.flowPolicy.id, a.priority]), [[EMAIL_POLICY, 4], [SMS_POLICY, 5]]);
  assert.deepEqual(fake.assigns[U][0], { id: 'old1', flowPolicy: { id: 'some-other' }, priority: 3 });
  assert.ok(fake.backupBeforeWrite.length === 3 && fake.backupBeforeWrite.every(Boolean), 'backup existed before every write');
  assert.match(r.text, /REVERT: PUT \/applications\/83572007-b2c7-4862-8197-dc225a9fb8e1 with the "app" object from .*83572007-b2c7-4862-8197-dc225a9fb8e1\.2026.*backup\.json/);
  assert.match(r.text, /DELETE \/applications\/83572007-b2c7-4862-8197-dc225a9fb8e1\/flowPolicyAssignments\/asg-1-0000-0000-0000/);
  assert.match(r.text, /DELETE .*asg-2-0000-0000-0000/);
  assert.match(r.text, /PingOne added \(not an error\): .*hiddenFromAppPortal.*signing|PingOne added \(not an error\): .*signing.*hiddenFromAppPortal/);
  assert.match(r.text, /update-app 83572007… \(applied, verified\)/);
  assert.doesNotMatch(r.text, /UNVERIFIED/);

  const before = writes(fake).length;
  const again = await run(fake, out, { which: 'user', apply: true });
  assert.equal(again.ops.length, 0); assert.equal(writes(fake).length, before);
  const files = fs.readdirSync(out).sort();
  assert.equal(files.length, 3, 'a new timestamped backup per run, none overwritten');
  assert.match(again.text, /EARLIEST/);
  // the first (pristine) backup still holds the pre-change grants
  const orig = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
  assert.deepEqual(orig.app.grantTypes, ['AUTHORIZATION_CODE', 'REFRESH_TOKEN']);
});

test('PUT ok but read-back drops a field: REVERT already printed, APPLIED, UNVERIFIED, no assignment POSTs', async () => {
  const out = tmp(); const fake = fakePingOne({ outDir: out, dropOnPut: 'redirectUris' });
  const r = await run(fake, out, { which: 'user', apply: true });
  assert.equal(r.failed, true);
  assert.match(r.text, /REVERT: PUT/);
  assert.ok(r.text.indexOf('REVERT: PUT') < r.text.indexOf('ERROR:'));
  assert.match(r.text, /redirectUris/);
  assert.match(r.text, /update-app 83572007… \(APPLIED, UNVERIFIED\)/);
  assert.match(r.text, /not applied: post|not applied: .*add-flow-policy/);
  assert.equal(fake.log.filter((l) => l.method === 'POST').length, 0);
});

test('first POST fails after PUT: summary splits applied/not; re-run completes only the missing assignments', async () => {
  const out = tmp(); const fake = fakePingOne({ outDir: out, failPostNumber: 1 });
  const r = await run(fake, out, { which: 'user', apply: true });
  assert.equal(r.failed, true);
  assert.match(r.text, /applied: update-app 83572007… \(applied, verified\)/);
  assert.match(r.text, /not applied: add-flow-policy 83572007…; add-flow-policy 83572007…/);
  assert.equal(fake.assigns[U].length, 1);
  const rerun = await run(fake, out, { which: 'user', apply: true });
  assert.equal(rerun.failed, false);
  assert.deepEqual(rerun.ops.map((o) => o.op), ['add-flow-policy', 'add-flow-policy']);
  assert.equal(fake.log.filter((l) => l.method === 'PUT').length, 1, 'grant not re-PUT');
  assert.deepEqual(fake.assigns[U].slice(1).map((a) => a.flowPolicy.id), [EMAIL_POLICY, SMS_POLICY]);
});

for (const which of ['admin', 'both']) {
  test(`--app ${which} with UNRESTRICTED admin: zero writes to admin, BLOCKED note`, async () => {
    const out = tmp(); const fake = fakePingOne({ outDir: out });
    const r = await run(fake, out, { which, apply: true });
    assert.match(r.text, /BLOCKED/);
    assert.ok(writes(fake).every((w) => !w.p.includes(A)));
    assert.equal(writes(fake).length, which === 'both' ? 3 : 0);
  });
  test(`--app ${which} with RESTRICTED admin: same additive ops as customer`, async () => {
    const out = tmp(); const fake = fakePingOne({ outDir: out, adminRestricted: true });
    const r = await run(fake, out, { which, apply: true });
    assert.equal(r.failed, false);
    assert.doesNotMatch(r.text, /BLOCKED/);
    assert.ok(fake.apps[A].grantTypes.includes('CIBA'));
    assert.deepEqual(fake.assigns[A].map((a) => a.flowPolicy.id), [EMAIL_POLICY, SMS_POLICY]);
    assert.equal(writes(fake).filter((w) => w.p.includes(A)).length, 3);
  });
}

test('never any delete verb, and only planned targets are written, across a full run', async () => {
  const out = tmp(); const fake = fakePingOne({ outDir: out, adminRestricted: true });
  await run(fake, out, { which: 'both', apply: true });
  await run(fake, out, { which: 'both', apply: true });
  assert.ok(fake.log.every((l) => !['DELETE', 'PATCH'].includes(l.method)));
  assert.ok(writes(fake).every((w) => (w.method === 'PUT' && /^\/applications\/[^/]+$/.test(w.p)) || (w.method === 'POST' && /^\/applications\/[^/]+\/flowPolicyAssignments$/.test(w.p))));
  assert.ok(writes(fake).every((w) => w.p.includes(U) || w.p.includes(A)));
});
