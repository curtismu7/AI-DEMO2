#!/usr/bin/env node
'use strict';

/**
 * Merges ONE inert "publish-time probe" rule INTO an export of the live PingOne Authorize tree, for the kill-switch demo
 * (how long does a published policy change take to apply?). Never a standalone package.
 *
 *   node snapshots/merge-ks-timing-probe.js <export.json> [out.json]
 *
 * WHY A MERGER: a P1AZ publish replaces the ENTIRE authorization version. A standalone package makes its lone root set the whole
 * tree and every live rule stops being evaluated (see the header of merge-mcp-amount-bands.js). So: export the live tree, add to it,
 * re-import, publish. Same shape as merge-airline-booking-rules.js.
 *
 * WHAT IT ADDS (all inert for real traffic, which never sends KsProbe; the attribute defaults to "none")
 *   attribute   KsProbe (STRING, default "none", read from the decision request)
 *   condition   KsProbeIsDenyMe  (KsProbe == "deny-me")
 *   statement   ks_deny (DENY)
 *   rule        "KS Timing Probe Deny", attached to "AI Demo Transaction Authorization" ahead of its catch-all
 * Only a decision request carrying KsProbe=deny-me is denied; that is the probe the timing watcher sends.
 *
 * SAFETY: refuses (nothing written) unless the target policy exists, there is exactly one PolicySet, ids are unique and every
 * reference resolves. Idempotent. The ids are fixed so a later export that already contains the probe is recognised, not duplicated.
 * To remove the probe: re-import your pre-merge export and publish.
 * Full runbook: docs/p1az-ks-timing-probe.md
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TARGET_POLICY = 'AI Demo Transaction Authorization';
const IDS = {"attr": "7da2eda4-a891-48bd-8be4-baaeabbc1a32", "cond": "dda127bf-90ae-47a0-a0a1-7893691bede4", "stmt": "12d11f64-ac52-45a0-8cb5-3052b81b2853", "rule": "77c112b2-328b-4677-a71c-d9b8dbe780f0"};

const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const uuidFrom = (s) => { const h = crypto.createHash('sha256').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4321-abcd-${h.slice(12, 24)}`; };

function buildObjects() {
  const rc = { and: { conditions: [{ reference: { id: IDS.cond } }] } };
  return {
    attr: { objectType: 'AttributeDefinition', id: IDS.attr, version: uuidFrom('ks-attr'), type: 'ATTRIBUTE', name: 'KsProbe', fullName: 'KsProbe',
      description: 'Kill-switch publish-time probe. Never sent by real traffic; defaults to none so an omitted value never goes INDETERMINATE.',
      parentId: null, numberOfChildren: null, valueProcessor: null, valueType: 'STRING',
      resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
      defaultValue: 'none', repetitionSource: null, valueSchema: null },
    cond: { objectType: 'ConditionDefinition', id: IDS.cond, version: uuidFrom('ks-cond'), type: 'CONDITION', name: 'KsProbeIsDenyMe', fullName: 'KsProbeIsDenyMe',
      description: 'KsProbe equals deny-me. Kill-switch publish-time probe.', parentId: null, numberOfChildren: null,
      condition: { comparison: { left: { attribute: { id: IDS.attr } }, op: 'Equals', right: { constant: { value: 'deny-me' } } } } },
    stmt: { id: IDS.stmt, version: uuidFrom('ks-stmt'), type: 'Statement', name: 'KS Timing Probe Denied', shared: false, description: 'Kill-switch publish-time probe.',
      code: 'ks_deny', appliesTo: 'DENY', appliesIf: 'PATH_MATCHES', payload: 'KS timing probe denied.', obligatory: false, attributes: [], services: [] },
    rule: { id: IDS.rule, version: uuidFrom('ks-rule'), type: 'Rule', targets: [], name: 'KS Timing Probe Deny',
      description: 'DENY only when KsProbe is deny-me (kill-switch publish-time probe; inert for real traffic).', shared: false, disabled: false,
      statements: [IDS.stmt], effectSettings: { type: 'conditionalDenyElsePermit', condition: rc }, condition: rc },
  };
}

function mergeKsTimingProbe(exported) {
  const pkg = JSON.parse(JSON.stringify(exported));
  const policy = pkg.find((o) => o && o.type === 'Policy' && o.name === TARGET_POLICY);
  if (!policy) throw new Error(`target policy "${TARGET_POLICY}" not found: this is not an export of the live tree (a standalone package would replace it)`);
  if (pkg.filter((o) => o && o.type === 'PolicySet').length !== 1) throw new Error('the package must contain exactly one PolicySet');
  if (pkg.some((o) => o && o.id === IDS.attr)) return { merged: pkg, changed: false };
  if (pkg.some((o) => o && o.type === 'ATTRIBUTE' && o.name === 'KsProbe')) throw new Error('a different KsProbe attribute already exists; refusing to guess');
  const taken = new Set(pkg.filter((o) => o && o.id).map((o) => o.id));
  for (const id of Object.values(IDS)) if (taken.has(id)) throw new Error(`id ${id} already used by another object`);

  const ob = buildObjects();
  let last = -1;
  pkg.forEach((o, i) => { if (o && o.objectType === 'AttributeDefinition') last = i; });
  pkg.splice(last + 1, 0, ob.attr);
  pkg.splice(pkg.findIndex((o) => o && o.type === 'SnapshotPackageFile$PackageSeparator'), 0, ob.cond);
  const firstPolicy = pkg.findIndex((o) => o && o.type === 'Policy');
  pkg.splice(firstPolicy, 0, ob.stmt, ob.rule);

  const target = pkg.find((o) => o && o.type === 'Policy' && o.name === TARGET_POLICY);
  const ruleById = new Map(pkg.filter((o) => o && o.type === 'Rule').map((r) => [r.id, r]));
  const catchAll = target.children.findIndex((c) => ruleById.get(c.id) && stable(ruleById.get(c.id).condition) === stable({ empty: {} }));
  const child = { id: IDS.rule, type: 'Rule' };
  if (catchAll < 0) target.children.push(child); else target.children.splice(catchAll, 0, child);
  // PingOne SKIPS an object whose version is unchanged, so the policy needs a new (content-derived, deterministic) version.
  target.version = uuidFrom(stable(target.children));

  // validation
  const ids = pkg.filter((o) => o && o.id).map((o) => o.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate ids after merge');
  const known = new Set(ids);
  const refs = new Set(ob.rule.statements);
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.attribute && n.attribute.id) refs.add(n.attribute.id); if (n.reference && n.reference.id) refs.add(n.reference.id); Object.values(n).forEach(walk); };
  walk(ob.cond.condition); walk(ob.rule.condition);
  for (const r of refs) if (!known.has(r)) throw new Error(`dangling reference ${r}`);
  return { merged: pkg, changed: true };
}

function main() {
  const src = process.argv[2];
  if (!src) { console.error('usage: node snapshots/merge-ks-timing-probe.js <export.json> [out.json]'); process.exit(1); }
  const out = process.argv[3] || path.join(process.cwd(), 'ks-timing.merged.snapshot.json');
  try {
    const res = mergeKsTimingProbe(JSON.parse(fs.readFileSync(src, 'utf8')));
    if (!res.changed) { console.log('export already contains the KsProbe rule: nothing to do'); return; }
    fs.writeFileSync(out, `${JSON.stringify(res.merged)}\n`);
    console.log(`Wrote ${out}`);
    console.log('  added: attribute KsProbe, condition KsProbeIsDenyMe, statement ks_deny, rule "KS Timing Probe Deny"');
    console.log(`  modified: policy "${TARGET_POLICY}" (+1 child, new version). Everything else is unchanged.`);
    console.log('  Next: import in the console (Authorize > Trust Framework > Import), then Publish. Undo: re-import your original export and publish.');
  } catch (err) {
    console.error(`REFUSING TO WRITE: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { mergeKsTimingProbe, TARGET_POLICY, IDS };
