import { readFileSync } from 'node:fs';
import cedar from '@cedar-policy/cedar-wasm/nodejs';
const schema = readFileSync(new URL('./schema.cedarschema', import.meta.url), 'utf8');
const policies = JSON.parse(readFileSync(new URL('./policies.json', import.meta.url), 'utf8'));
const policySet = { staticPolicies: policies, templates: {}, templateLinks: [] };
console.log('cedar', cedar.getCedarVersion(), 'lang', cedar.getCedarLangVersion());
const v = cedar.validate({ validationSettings: { mode: 'strict' }, schema, policies: policySet });
console.log('validate', v.type, 'errors:', v.validationErrors?.length, 'warnings:', v.validationWarnings?.length);
const uid = (type, id) => ({ type, id });
// PF claims -> principal entity + Group parents (the whole mapping layer is this function)
function entitiesFromClaims(c) {
  const groups = c.groups || [];
  return [{ uid: uid('User', c.sub), attrs: {}, parents: groups.map(g => uid('Group', g)) },
          ...groups.map(g => ({ uid: uid('Group', g), attrs: {}, parents: [] }))];
}
const toolIds = ['search_docs','create_ticket','pay_invoice','book_fare'];
const apps = { search_docs:'search', create_ticket:'ticketing', pay_invoice:'payments', book_fare:'booking' };
function ask(label, claims, action, tool, over = {}, args = {}) {
  const ctx = { app: apps[tool], args, token: { scopes: claims.scope.split(' '), client_id: claims.client_id, ...(claims.act ? { actor: claims.act.sub } : {}) },
    approval_count: 0, pinnedHash: 'h-'+tool, observedHash: 'h-'+tool, ...over };
  const r = cedar.isAuthorized({ principal: uid('User', claims.sub), action: uid('Action', action), resource: uid('Tool', tool),
    context: ctx, schema, validateRequest: true, policies: policySet,
    entities: [...entitiesFromClaims(claims), ...toolIds.map(t => ({ uid: uid('Tool', t), attrs: {}, parents: [] }))] });
  if (r.type !== 'success') return console.log(label, 'FAIL', JSON.stringify(r.errors).slice(0,300));
  console.log(label.padEnd(46), r.response.decision.padEnd(6), JSON.stringify(r.response.diagnostics.reason));
}
const mary = { sub:'mary', groups:['analysts'], scope:'tools:invoke', client_id:'dot' };
const fin  = { sub:'fin1', groups:['analysts','finance'], scope:'tools:invoke payments:write', client_id:'dot' };
const ta   = { sub:'ta1', groups:['travel-agents'], scope:'tools:invoke', client_id:'dot', act:{sub:'dot'} };
ask('S04 mary -> search_docs', mary, 'mcp:Invoke','search_docs');
ask('S04 mary -> create_ticket', mary, 'mcp:Invoke','create_ticket');
ask('S04 mary -> pay_invoice (no policy: default deny)', mary, 'mcp:Invoke','pay_invoice');
ask('S04 finance -> pay_invoice', fin, 'mcp:Invoke','pay_invoice');
ask('S05 mary -> search_docs, schema drifted', mary, 'mcp:Invoke','search_docs',{observedHash:'h-EVIL'});
ask('S01 ta1 -> book_fare 2400 (unattended)', ta, 'mcp:InvokeUnattended','book_fare',{},{amount:2400});
ask('S01 same, approval_count=1', ta, 'mcp:InvokeUnattended','book_fare',{approval_count:1},{amount:2400});
ask('S01 ta1 -> book_fare 400 (unattended)', ta, 'mcp:InvokeUnattended','book_fare',{},{amount:400});
ask('S23 ta1 -> book_fare 12000 (forbid beats permit)', ta, 'mcp:Invoke','book_fare',{},{amount:12000});
ask('S23 ta1 -> book_fare 900', ta, 'mcp:Invoke','book_fare',{},{amount:900});
// negative: vocabulary the engine does not have
const bad = { staticPolicies: { bad: 'permit (principal, action, resource) when { context.claims.groups.contains("x") };' }, templates:{}, templateLinks:[] };
const bv = cedar.validate({ validationSettings:{mode:'strict'}, schema, policies: bad });
console.log('context.claims policy ->', bv.validationErrors?.[0]?.error?.message);
