'use strict';

// The kill-switch publish-time probe merges ONE inert rule INTO an export of the live Authorize tree. These tests pin the safety
// properties: pure addition, one modified policy, one PolicySet, idempotent, inert for normal requests, and refusal of a standalone package.
// (A P1AZ publish replaces the ENTIRE authorization version: a package that is not export + additions wipes the live rules.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mergeKsTimingProbe, TARGET_POLICY, IDS } = require('./merge-ks-timing-probe');
const SNAPSHOT = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');
const load = () => JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const byName = (pkg, type, name) => pkg.find((o) => o && o.type === type && o.name === name);

test('adds exactly four objects and modifies exactly one policy', () => {
  const orig = load();
  const { merged, changed } = mergeKsTimingProbe(orig);
  assert.equal(changed, true);
  assert.equal(merged.length, orig.length + 4);
  const ids = new Set([IDS.attr, IDS.cond, IDS.stmt, IDS.rule]);
  const added = merged.filter((o) => o && ids.has(o.id));
  assert.deepEqual(added.map((o) => o.name).sort(), ['KS Timing Probe Denied', 'KS Timing Probe Deny', 'KsProbe', 'KsProbeIsDenyMe']);
  // every original object survives unchanged except the target policy
  const mergedStr = new Set(merged.map((o) => JSON.stringify(o)));
  const lost = orig.filter((o) => !mergedStr.has(JSON.stringify(o)));
  assert.deepEqual(lost.map((o) => o.name), [TARGET_POLICY]);
  const before = byName(orig, 'Policy', TARGET_POLICY);
  const after = byName(merged, 'Policy', TARGET_POLICY);
  assert.equal(after.children.length, before.children.length + 1);
  assert.deepEqual(after.children.filter((c) => c.id !== IDS.rule), before.children, 'original rules kept, in order');
  assert.notEqual(after.version, before.version, 'PingOne skips an object whose version is unchanged');
});

test('there is still exactly one PolicySet and every reference resolves', () => {
  const { merged } = mergeKsTimingProbe(load());
  assert.equal(merged.filter((o) => o && o.type === 'PolicySet').length, 1);
  const ids = new Set(merged.filter((o) => o && o.id).map((o) => o.id));
  assert.equal(ids.size, merged.filter((o) => o && o.id).length, 'ids unique');
  const rule = merged.find((o) => o && o.id === IDS.rule);
  rule.statements.forEach((s) => assert.ok(ids.has(s)));
  assert.ok(ids.has(IDS.attr) && ids.has(IDS.cond));
});

test('the attribute defaults to none, so an omitted KsProbe never goes INDETERMINATE or matches', () => {
  const { merged } = mergeKsTimingProbe(load());
  const attr = merged.find((o) => o && o.id === IDS.attr);
  assert.equal(attr.defaultValue, 'none');
  assert.equal(attr.valueType, 'STRING');
  assert.equal(attr.resolvers[0].attributeResolverType, 'request');
});

test('idempotent: merging the merged package changes nothing', () => {
  const once = mergeKsTimingProbe(load()).merged;
  const twice = mergeKsTimingProbe(once);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.merged, once);
});

test('inert for normal requests, denies only KsProbe=deny-me (offline evaluator)', async () => {
  const { predict } = await import('../scripts/predict-p1az-denies.mjs');
  const { merged } = mergeKsTimingProbe(load());
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-probe-')), 'merged.snapshot.json');
  fs.writeFileSync(tmp, JSON.stringify(merged));
  const request = { DecisionContext: 'Transaction', McpMethod: '', ToolName: '', Amount: '', TransactionType: '', UserId: 'u1' };
  const baseline = predict(SNAPSHOT, request);
  const normal = predict(tmp, request);
  assert.deepEqual(normal.fired, baseline.fired, 'a normal request fires exactly the same deny rules as before');
  const probe = predict(tmp, { ...request, KsProbe: 'deny-me' });
  assert.deepEqual(probe.fired.filter((n) => !baseline.fired.includes(n)), ['KS Timing Probe Deny']);
});

test('refuses a malformed export and a partly-present probe (no silent bad file, no silent skip)', () => {
  const noSep = load().filter((o) => !(o && o.type === 'SnapshotPackageFile$PackageSeparator'));
  assert.throws(() => mergeKsTimingProbe(noSep), /PackageSeparator/);
  const noAttrs = load().filter((o) => !(o && o.objectType === 'AttributeDefinition'));
  assert.throws(() => mergeKsTimingProbe(noAttrs), /AttributeDefinition/);
  const merged = mergeKsTimingProbe(load()).merged;
  const noRule = merged.filter((o) => !(o && o.id === IDS.rule));
  assert.throws(() => mergeKsTimingProbe(noRule), /partial import/);
});

test('refuses a standalone package (a publish would replace the whole tree)', () => {
  const orig = load();
  const noPolicy = orig.filter((o) => !(o && o.type === 'Policy' && o.name === TARGET_POLICY));
  assert.throws(() => mergeKsTimingProbe(noPolicy), /target policy/i);
  const twoSets = [...orig];
  const set = orig.find((o) => o && o.type === 'PolicySet');
  twoSets.splice(twoSets.indexOf(set), 0, { ...set, id: 'ffffffff-0000-4000-8000-000000000001', name: 'Second root set' });
  assert.throws(() => mergeKsTimingProbe(twoSets), /exactly one PolicySet/i);
  assert.throws(() => mergeKsTimingProbe([{ '@class': 'DataStreamHeader' }]), /target policy|PolicySet/i);
});
