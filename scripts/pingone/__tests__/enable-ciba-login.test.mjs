// node --test scripts/pingone/__tests__/enable-ciba-login.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { planCibaLogin, EMAIL_POLICY, SMS_POLICY } from '../enable-ciba-login.mjs';

const fps = [{ id: EMAIL_POLICY, name: 'CIBA - EMAIL' }, { id: SMS_POLICY, name: 'CIBA-SMS' }];
const userApp = () => ({ id: 'u1', name: 'User', grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', pkceEnforcement: 'S256_REQUIRED' });
const adminApp = (accessControl) => ({ id: 'a1', name: 'Admin', grantTypes: ['AUTHORIZATION_CODE'], accessControl });
const restricted = { group: { type: 'ANY_GROUP', groups: [{ id: 'g1' }] } };
const apps = (...x) => x;
const fpa = (id, priority) => ({ id: 'x' + priority, flowPolicy: { id }, priority });

test('customer: adds CIBA grant (keeping all others) and both policies, never deletes', () => {
  const ops = planCibaLogin(apps({ role: 'user', app: userApp() }), { u1: [] }, fps);
  assert.equal(ops.length, 3);
  assert.deepEqual(ops[0].body.grantTypes, ['AUTHORIZATION_CODE', 'REFRESH_TOKEN', 'CIBA']);
  assert.equal(ops[0].body.pkceEnforcement, 'S256_REQUIRED');
  assert.equal(ops[0].body.tokenEndpointAuthMethod, 'CLIENT_SECRET_POST');
  assert.deepEqual(ops.slice(1).map((o) => o.body.flowPolicy.id), [EMAIL_POLICY, SMS_POLICY]);
  assert.ok(ops.every((o) => !/delete|reorder|remove/i.test(o.op)));
});

test('idempotent: applied state plans nothing', () => {
  const a = userApp(); a.grantTypes.push('CIBA');
  assert.equal(planCibaLogin(apps({ role: 'user', app: a }), { u1: [fpa(EMAIL_POLICY, 1), fpa(SMS_POLICY, 2)] }, fps).length, 0);
});

test('app already holding one policy gets only the other, after existing priorities', () => {
  const a = userApp(); a.grantTypes.push('CIBA');
  const ops = planCibaLogin(apps({ role: 'user', app: a }), { u1: [fpa(EMAIL_POLICY, 4)] }, fps);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].body.flowPolicy.id, SMS_POLICY);
  assert.equal(ops[0].body.priority, 5);
});

test('unknown flow policy id is a hard error, not a blind assignment', () => {
  assert.throws(() => planCibaLogin(apps({ role: 'user', app: userApp() }), { u1: [] }, [fps[0]]), /CIBA-SMS|not found/i);
});

test('unrestricted admin: nothing planned, blocking note; customer still planned', () => {
  for (const ac of [undefined, {}, { group: { type: 'ANY_GROUP', groups: [] } }]) {
    const ops = planCibaLogin(apps({ role: 'user', app: userApp() }, { role: 'admin', app: adminApp(ac) }), { u1: [], a1: [] }, fps);
    assert.ok(ops.every((o) => o.target === 'u1'));
    assert.equal(ops.length, 3);
    assert.match(ops.notes.join(' '), /BLOCKED/);
  }
});

test('restricted admin gets the same additive ops as customer', () => {
  const ops = planCibaLogin(apps({ role: 'admin', app: adminApp(restricted) }), { a1: [] }, fps);
  assert.equal(ops.length, 3);
  assert.ok(ops.every((o) => o.target === 'a1'));
  assert.equal(ops.notes.length, 0);
});

test('role-restricted admin (ADMIN_USERS_ONLY) counts as restricted', () => {
  const ops = planCibaLogin(apps({ role: 'admin', app: adminApp({ role: { type: 'ADMIN_USERS_ONLY' } }) }), { a1: [] }, fps);
  assert.equal(ops.length, 3);
});

import { diffApps, backupName, originalBackup, parseArgs, pickByName } from '../enable-ciba-login.mjs';

test('role without a real type, bogus types, group without type are NOT restrictions', () => {
  for (const ac of [{ role: {} }, { role: { type: 'BOGUS' } }, { group: { groups: [{ id: 'g' }] } }, { group: { type: 'NOPE', groups: [{ id: 'g' }] } }]) {
    const ops = planCibaLogin(apps({ role: 'admin', app: adminApp(ac) }), { a1: [] }, fps);
    assert.equal(ops.length, 0);
    assert.match(ops.notes[0], /BLOCKED/);
  }
});

test('null/missing grantTypes treated as []', () => {
  for (const g of [null, undefined]) {
    const a = { ...userApp(), grantTypes: g };
    const ops = planCibaLogin(apps({ role: 'user', app: a }), { u1: [] }, fps);
    assert.deepEqual(ops[0].body.grantTypes, ['CIBA']);
  }
});

test('planCibaLogin does not mutate inputs', () => {
  const a = apps({ role: 'user', app: userApp() }); const asg = { u1: [fpa(EMAIL_POLICY, 1)] };
  const snap = JSON.stringify([a, asg, fps]);
  planCibaLogin(a, asg, fps);
  assert.equal(JSON.stringify([a, asg, fps]), snap);
});

const full = () => ({ id: 'u1', environment: { id: 'e' }, createdAt: 't', name: 'U', grantTypes: ['AUTHORIZATION_CODE'], redirectUris: ['https://a/cb'], accessControl: { group: { type: 'ANY_GROUP', groups: [{ id: 'g' }] } }, tokenLifetime: { a: 1, b: 2 } });
const withCiba = (x) => ({ ...x, grantTypes: [...x.grantTypes, 'CIBA'] });
test('diffApps: lossless result (key order and server-populated fields ignored) -> no diffs', () => {
  const b = full(); const a = withCiba(b); a.updatedAt = 'later'; a.tokenLifetime = { b: 2, a: 1 };
  assert.deepEqual(diffApps(b, a), []);
});
test('diffApps names dropped/changed fields and wrong grants', () => {
  const b = full();
  const a = withCiba(b); delete a.redirectUris; a.accessControl = {};
  assert.deepEqual(diffApps(b, a).sort(), ['accessControl', 'redirectUris']);
  assert.deepEqual(diffApps(b, b), ['grantTypes']); // CIBA missing
  const r = withCiba(b); r.grantTypes = ['CIBA', 'AUTHORIZATION_CODE'];
  assert.deepEqual(diffApps(b, r), []); // PingOne reorders grantTypes: order is not a difference
  r.grantTypes = ['CIBA']; // a dropped existing grant is
  assert.deepEqual(diffApps(b, r), ['grantTypes']);
});

test('backups are timestamped, never the same name twice, original = earliest', () => {
  const n1 = backupName('u1', new Date('2026-10-17T10:00:00Z')); const n2 = backupName('u1', new Date('2026-10-17T11:00:00Z'));
  assert.notEqual(n1, n2);
  assert.ok(!n1.includes(':'));
  assert.equal(originalBackup([n2, n1, backupName('a1', new Date('2026-01-01T00:00:00Z'))], 'u1'), n1);
});

test('parseArgs validates', () => {
  assert.deepEqual(parseArgs(['--out', 'd', '--apply']), { app: 'both', apply: true, probe: false, out: 'd' });
  for (const bad of [[], ['--out'], ['--out', '--apply'], ['--out', 'd', '--app', 'x'], ['--out', 'd', '--zzz']]) assert.throws(() => parseArgs(bad));
});

test('duplicate or missing app names fail loudly', () => {
  assert.throws(() => pickByName([{ name: 'A' }, { name: 'A' }], 'A'), /found 2/);
  assert.throws(() => pickByName([], 'A'), /found 0/);
  assert.equal(pickByName([{ name: 'A', id: 1 }], 'A').id, 1);
});
