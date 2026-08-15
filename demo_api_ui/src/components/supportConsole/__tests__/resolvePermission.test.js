import { resolvePermission } from '../resolvePermission';
import { CONFIGS, VERTICAL_ORDER } from '../supportConsoleConfig';

// The real scope vocabulary — see demo_api_server/config/scopes.js. Do not
// invent finer-grained names; nothing issues them.
const S = ['general:read', 'general:write', 'transactions:write'];

it('missing scope is denied regardless of gate', () => {
  expect(resolvePermission({ permission: { scope: 'sensitive:read', gate: 'none' }, scopes: S, verified: true }))
    .toBe('denied');
});

it('gate none with the scope present is allowed even unverified', () => {
  expect(resolvePermission({ permission: { scope: 'general:write', gate: 'none' }, scopes: S, verified: false }))
    .toBe('allowed');
});

it('gate verified is verify-first while unverified and allowed once verified', () => {
  const permission = { scope: 'transactions:write', gate: 'verified' };
  expect(resolvePermission({ permission, scopes: S, verified: false })).toBe('verify-first');
  expect(resolvePermission({ permission, scopes: S, verified: true })).toBe('allowed');
});

it('gate approval stays approval even when verified', () => {
  expect(resolvePermission({ permission: { scope: 'transactions:write', gate: 'approval' }, scopes: S, verified: true }))
    .toBe('approval');
});

it('gate never is denied even with the scope and verification', () => {
  expect(resolvePermission({ permission: { scope: 'transactions:write', gate: 'never' }, scopes: S, verified: true }))
    .toBe('denied');
});

it('every declared scope exists in the real vocabulary', () => {
  const REAL = [
    'accounts:read', 'admin:read', 'agent:invoke', 'general:read', 'general:write',
    'mcp:invoke', 'mortgage:read', 'sensitive:read', 'transactions:read', 'transactions:write',
  ];
  const invented = [];
  for (const id of VERTICAL_ORDER) {
    for (const [label, p] of Object.entries(CONFIGS[id].permissions)) {
      if (!REAL.includes(p.scope)) invented.push(`${id}.${label} -> ${p.scope}`);
    }
  }
  expect(invented).toEqual([]);
});

it('an unknown action is denied, never implicitly allowed', () => {
  expect(resolvePermission({ permission: undefined, scopes: S, verified: true })).toBe('denied');
});

it('every declared action has a permission entry', () => {
  const missing = [];
  for (const id of VERTICAL_ORDER) {
    const cfg = CONFIGS[id];
    for (const label of Object.keys(cfg.actions)) {
      if (!cfg.permissions?.[label]) missing.push(`${id}: ${label}`);
    }
  }
  expect(missing).toEqual([]);
});

it('every vertical declares identityActions and caseSource', () => {
  for (const id of VERTICAL_ORDER) {
    expect(Array.isArray(CONFIGS[id].identityActions)).toBe(true);
    expect(CONFIGS[id].caseSource?.path).toMatch(/^\/api\/admin\/.+\/cases$/);
  }
});
