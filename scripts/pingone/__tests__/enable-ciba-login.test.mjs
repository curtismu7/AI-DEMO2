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
