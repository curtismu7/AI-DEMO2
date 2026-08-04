/**
 * @file snapshots/authorizeSnapshotTierPolicy.test.js
 *
 * Coverage for step 10 of gen-authorize-snapshot.js — the UC21 banking tier
 * policy ("$2,000 Standard vs $50,000 PrivateBanking; group membership expands
 * capability"), the demo's most concrete authorization story.
 *
 * WHY THIS SUITE EXISTS
 *
 * The three conditions below (IsStandardTier, IsTierRestrictedTool,
 * ExceedsTierAmountCap) were already in the cloud policy and already imported.
 * What they were not is GENERATED: they sat outside reconcile() with their tool
 * list and ceilings hand-typed, while the simulator read the same story from the
 * banking vertical manifest's `tiers` block via groupPolicy.getTierDefinitions().
 * Two engines, two copies of the number, nothing comparing them — and they had
 * already drifted (the snapshot gates `withdraw`, the manifest does not).
 *
 * So the assertions that matter here are not "the committed snapshot says 2000".
 * That passes just as well against a hardcoded constant. The load-bearing tests
 * INJECT a different manifest and require the emitted policy to follow it. Delete
 * step 10 from the reconciler and those go red; a snapshot-only assertion would
 * not.
 *
 * Run: node --test snapshots/authorizeSnapshotTierPolicy.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const {
  reconcile,
  loadSot,
  loadTiers,
  deriveTiers,
  TIER_VERSION_GROUP,
  ATTR,
  COND,
  SNAP,
  BANKING_MANIFEST,
} = require('./gen-authorize-snapshot.js');

const readSnapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const readManifest = () => JSON.parse(fs.readFileSync(BANKING_MANIFEST, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const findById = (snap, id) => snap.find((o) => o.id === id);

/** Regenerate a fresh copy of the committed snapshot against injected tier data. */
const regenWith = (tiers) => reconcile(clone(readSnapshot()), loadSot(), tiers);

/** Every string constant a condition compares against, in document order. */
function constantsOf(cond) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    const c = n.comparison && n.comparison.right && n.comparison.right.constant;
    if (c && typeof c.value === 'string') out.push(c.value);
    if (n.and) (n.and.conditions || []).forEach(walk);
    if (n.or) (n.or.conditions || []).forEach(walk);
    if (n.not) walk(n.not.condition);
  };
  walk(cond.condition);
  return out;
}

/** [tier, ceiling] pairs read back out of the emitted ExceedsTierAmountCap. */
function ceilingsOf(cond, defaultTier) {
  return (cond.condition.or.conditions || []).map((branch) => {
    const [tierNode, amountNode] = branch.and.conditions;
    // Three shapes the default tier's branch has taken:
    //   not        — CURRENT: "none of the named non-default tiers". UserTier
    //                defaults to 'none' and is often not sent at all, so an
    //                equality against 'Standard' matched no branch and left an
    //                over-cap amount denied by nothing. The negation makes the
    //                capped tier the fallback.
    //   reference  — the older IsStandardTier reference.
    //   comparison — a named non-default tier.
    let tier;
    if (tierNode.not || tierNode.reference) {
      tier = defaultTier;
    } else {
      tier = tierNode.comparison.right.constant.value;
    }
    assert.strictEqual(amountNode.comparison.left.attribute.id, ATTR.Amount);
    assert.strictEqual(amountNode.comparison.op, 'GreaterThan');
    return [tier, amountNode.comparison.right.constant.value];
  });
}

// ── The source of truth ───────────────────────────────────────────────────────

test('deriveTiers reads the banking manifest tiers block', () => {
  const manifest = readManifest();
  const tiers = deriveTiers(manifest);

  assert.strictEqual(tiers.defaultTier, manifest.tiers.default);
  // Every declared tier gets a ceiling, and the default tier comes first so the
  // emitted branch order is stable for --check.
  assert.deepStrictEqual(
    tiers.ceilings.map(([t]) => t),
    [manifest.tiers.default, ...Object.keys(manifest.tiers.definitions)
      .filter((t) => t !== manifest.tiers.default).sort()],
  );
  for (const [tier, max] of tiers.ceilings) {
    assert.strictEqual(max, String(manifest.tiers.definitions[tier].maxAmountUsd));
  }
});

test('the committed snapshot ceilings equal the manifest — the drift gate', () => {
  // This is what `npm run snapshot:check` enforces on every topology:verify. It
  // is the assertion that would have caught the tier data diverging from the
  // simulator in the first place.
  const manifest = readManifest();
  const cond = findById(readSnapshot(), COND.ExceedsTierAmountCap);
  assert.ok(cond, 'ExceedsTierAmountCap must exist in the snapshot');

  for (const [tier, max] of ceilingsOf(cond, manifest.tiers.default)) {
    assert.strictEqual(
      max,
      String(manifest.tiers.definitions[tier].maxAmountUsd),
      `cloud ceiling for ${tier} disagrees with the banking manifest — ` +
      'run: node snapshots/gen-authorize-snapshot.js',
    );
  }
});

// ── Revert-to-RED: the policy must FOLLOW the manifest, not merely match it ───

test('RED PROOF — changing a manifest ceiling changes the emitted cloud ceiling', () => {
  const manifest = readManifest();
  const bumped = clone(manifest);
  bumped.tiers.definitions[manifest.tiers.default].maxAmountUsd = 7777;

  const cond = findById(regenWith(deriveTiers(bumped)), COND.ExceedsTierAmountCap);
  const emitted = new Map(ceilingsOf(cond, manifest.tiers.default));

  assert.strictEqual(
    emitted.get(manifest.tiers.default),
    '7777',
    'the default tier ceiling is hardcoded in the snapshot, not derived from the manifest — ' +
    'step 10 of gen-authorize-snapshot.js is missing or inert',
  );
  // The other tiers still track their own manifest values (not collapsed).
  for (const tier of Object.keys(manifest.tiers.definitions)) {
    if (tier === manifest.tiers.default) continue;
    assert.strictEqual(emitted.get(tier), String(manifest.tiers.definitions[tier].maxAmountUsd));
  }
});

test('RED PROOF — a new tier in the manifest gets its own cloud ceiling branch', () => {
  const manifest = readManifest();
  const extended = clone(manifest);
  extended.tiers.definitions.Concierge = { maxAmountUsd: 250000, restrictedTools: [] };

  const cond = findById(regenWith(deriveTiers(extended)), COND.ExceedsTierAmountCap);
  const emitted = new Map(ceilingsOf(cond, manifest.tiers.default));

  assert.strictEqual(
    emitted.get('Concierge'),
    '250000',
    'a tier added to the manifest never reaches the cloud policy — the ceilings are hardcoded',
  );
  assert.strictEqual(emitted.size, Object.keys(extended.tiers.definitions).length);
});

test('RED PROOF — the default tier name comes from tiers.default', () => {
  const manifest = readManifest();
  const renamed = clone(manifest);
  renamed.tiers.definitions.Basic = renamed.tiers.definitions[manifest.tiers.default];
  delete renamed.tiers.definitions[manifest.tiers.default];
  renamed.tiers.default = 'Basic';

  const cond = findById(regenWith(deriveTiers(renamed)), COND.IsStandardTier);
  assert.deepStrictEqual(
    constantsOf(cond),
    ['Basic'],
    'IsStandardTier hardcodes the tier name — renaming tiers.default would silently ' +
    'make every tier rule unreachable in the cloud while the simulator kept enforcing',
  );
});

test('RED PROOF — a tool added to the manifest joins the restricted list', () => {
  const manifest = readManifest();
  const extended = clone(manifest);
  extended.tiers.definitions[manifest.tiers.default].restrictedTools.push('wire_transfer_intl');

  const cond = findById(regenWith(deriveTiers(extended)), COND.IsTierRestrictedTool);
  assert.ok(
    constantsOf(cond).includes('wire_transfer_intl'),
    'restrictedTools is hardcoded in the snapshot — a tool restricted in the manifest ' +
    'would be callable by a Standard user against the real cloud policy',
  );
});

// ── The union rule: a generation pass must never SHRINK an enforcement list ───

test('the restricted-tool list is a union and can never shrink', () => {
  // Same stance as HasValidActorChain (step 1d): the manifest may only ADD. The
  // committed snapshot gates `withdraw` while the manifest lists only
  // `create_withdrawal` — real drift. Resolving it by dropping `withdraw` would
  // quietly widen what a Standard user may do, so generation keeps it.
  const committed = constantsOf(findById(readSnapshot(), COND.IsTierRestrictedTool));

  const emptied = clone(readManifest());
  emptied.tiers.definitions[emptied.tiers.default].restrictedTools = [];

  const after = constantsOf(findById(regenWith(deriveTiers(emptied)), COND.IsTierRestrictedTool));
  for (const tool of committed) {
    assert.ok(
      after.includes(tool),
      `emptying the manifest dropped "${tool}" from the cloud restriction — generation must never shrink`,
    );
  }
});

test('the manifest restricted tools are a subset of what the cloud enforces', () => {
  const tiers = loadTiers();
  const committed = constantsOf(findById(readSnapshot(), COND.IsTierRestrictedTool));
  for (const tool of tiers.restrictedTools) {
    assert.ok(committed.includes(tool), `manifest restricts "${tool}" but the cloud policy does not`);
  }
});

// ── Fail-closed guards: refuse to emit a rule that gates nothing ──────────────

test('a non-numeric ceiling is refused, not emitted as an unmatchable constant', () => {
  // null and '' coerce to 0, which is FINITE — a coercing guard would let them
  // through and emit a $0 ceiling that denies every amount. undefined emits
  // "undefined" and enforces nothing. All three must be refused.
  for (const bad of [null, undefined, '', 'lots', NaN, 0, -1]) {
    const broken = clone(readManifest());
    broken.tiers.definitions[broken.tiers.default].maxAmountUsd = bad;
    assert.throws(
      () => deriveTiers(broken),
      /not a positive number/,
      `maxAmountUsd=${JSON.stringify(bad)} must be refused`,
    );
  }
});

test('a missing default tier definition is refused', () => {
  const broken = clone(readManifest());
  broken.tiers.default = 'Nonexistent';
  assert.throws(() => deriveTiers(broken), /tiers\.default/);
});

test('a non-default tier restricting tools is refused rather than silently dropped', () => {
  // The cloud rule is `IsStandardTier AND IsTierRestrictedTool`, so only the
  // default tier's restrictions are expressible. Emitting anyway would gate the
  // wrong tier.
  const broken = clone(readManifest());
  const other = Object.keys(broken.tiers.definitions).find((t) => t !== broken.tiers.default);
  broken.tiers.definitions[other].restrictedTools = ['some_tool'];
  assert.throws(() => deriveTiers(broken), /DEFAULT tier only/);
});

// ── The import-skip trap ─────────────────────────────────────────────────────

test('changed tier content warns that the version must be bumped', () => {
  // PingOne SKIPS an object whose version is unchanged (the trap #615 hit with
  // the RAR quartet). A regenerated ceiling with a stale version imports as a
  // no-op: git looks right, the cloud keeps the old limit. The warning is the
  // only thing standing between a manifest edit and that silence.
  const bumped = clone(readManifest());
  bumped.tiers.definitions[bumped.tiers.default].maxAmountUsd = 9999;

  const original = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    regenWith(deriveTiers(bumped));
  } finally {
    console.warn = original;
  }

  assert.ok(
    lines.some((l) => l.includes('TIER_VERSION_GROUP')),
    'reconcile() must warn when tier content changes — otherwise the import silently no-ops',
  );
});

test('all three tier conditions carry the current version generation', () => {
  const snap = readSnapshot();
  for (const id of [COND.IsStandardTier, COND.IsTierRestrictedTool, COND.ExceedsTierAmountCap]) {
    const cond = findById(snap, id);
    assert.strictEqual(
      cond.version.split('-')[2],
      TIER_VERSION_GROUP,
      `${cond.name} version is not at generation ${TIER_VERSION_GROUP} — PingOne would skip it on import`,
    );
  }
  // Version UUIDs stay unique file-wide (the snapshot's own invariant).
  const versions = snap.map((o) => o.version).filter(Boolean);
  assert.strictEqual(new Set(versions).size, versions.length, 'duplicate version UUID in the snapshot');
});

// ── The PEP contract ─────────────────────────────────────────────────────────

test('UserTier is a request attribute that defaults to the inert value', () => {
  // Membership resolution stays at the PEP (tiers.groupToTier needs
  // array-contains, which this DSL lacks) — but the default must keep every
  // tier rule dormant until the BFF positively sends a tier.
  const attr = findById(readSnapshot(), ATTR.UserTier);
  assert.strictEqual(attr.name, 'UserTier');
  assert.strictEqual(attr.valueType, 'STRING');
  assert.strictEqual(attr.defaultValue, 'none');
  assert.deepStrictEqual(attr.resolvers.map((r) => r.attributeResolverType), ['request']);

  // 'none' must not be any real tier, or the default would enforce a ceiling.
  const tiers = loadTiers();
  assert.ok(!tiers.ceilings.some(([t]) => t === attr.defaultValue));
});

test('the ceilings are policy constants — no PEP-supplied ceiling attribute', () => {
  // Forwarding a pre-computed UserMaxAmountUsd would leave P1AZ evaluating
  // `Amount > whatever the BFF said` and move the actual policy back into
  // JavaScript, which is what this relocation exists to undo.
  const cond = findById(readSnapshot(), COND.ExceedsTierAmountCap);
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.comparison && n.comparison.right && n.comparison.right.attribute) {
      assert.fail('a tier ceiling is compared against an ATTRIBUTE — the threshold left the policy');
    }
    if (n.and) (n.and.conditions || []).forEach(walk);
    if (n.or) (n.or.conditions || []).forEach(walk);
  };
  walk(cond.condition);
});

test('regeneration with the real manifest is idempotent', () => {
  const committed = readSnapshot();
  const once = reconcile(clone(committed), loadSot(), loadTiers());
  assert.deepStrictEqual(once, committed, 'run: node snapshots/gen-authorize-snapshot.js');
  assert.deepStrictEqual(reconcile(once, loadSot(), loadTiers()), committed);
});
