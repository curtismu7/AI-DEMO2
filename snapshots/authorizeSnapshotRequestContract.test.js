'use strict';

/**
 * Two offline guards for the P1AZ snapshot ↔ PEP contract, from TECH_DEBT
 * 2026-08-17 (both entries):
 *
 * 1. VERSION LITERALS ("nothing rejects a new one"). PingOne skips any import
 *    object whose version is unchanged, so a literal version on an object whose
 *    content is generated makes the import a silent no-op — #1311 and #1897
 *    both shipped that way. `ver()` derives versions from content; a literal is
 *    legal ONLY for a deliberately frozen object, and freezing one is now an
 *    explicit act: add it to FROZEN_VERSION_LITERALS with a reason.
 *
 * 2. REQUEST-ATTRIBUTE CONTRACT ("nothing fails a build when a request omits an
 *    attribute the policy requires"). Live P1AZ returns INDETERMINATE — never a
 *    legitimate outcome here — when a condition references an attribute the
 *    request did not carry and no defaultValue rescues. The required set is
 *    DERIVED from the snapshot (request-resolved + no defaultValue + referenced
 *    by at least one CONDITION), so adding such an attribute to the policy
 *    without teaching a PEP to send it fails HERE, offline, instead of live as
 *    a policy bug. Legal fixes when this fails: send the attribute from the
 *    PEP, or give the attribute a defaultValue in the generator.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(__dirname, 'gen-authorize-snapshot.js');
const SNAPSHOT = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');

// ── 1. version literals ──────────────────────────────────────────────────────

// Deliberately frozen objects. Every entry must state why freezing is safe —
// i.e. why this object's CONTENT can never change while its version stands
// still. If you are here because the test failed on a literal you just added:
// the default is ver(); only freeze when the content is provably static.
const FROZEN_VERSION_LITERALS = [
  'dddddddd-0010-4321-abcd-000000000010', // RULE.mcpStepUp — static rule shell; its condition/statement children use ver()
  'cccccccc-0011-4321-abcd-000000000011', // STMT.txConsent — static statement payload (code + advice only)
  'dddddddd-0011-4321-abcd-000000000011', // RULE.txConsent — static rule shell
  'aaaaaaaa-0021-4321-abcd-000000000021', // RAR attribute — static definition (name/type), content not topology-derived
  'bbbbbbbb-0021-4321-abcd-000000000021', // RAR condition — static comparison against the RAR attribute
  'cccccccc-0021-4321-abcd-000000000021', // STMT.rarAmountExceeded — static statement payload
  'dddddddd-0021-4321-abcd-000000000021', // RULE.rarAmountExceeded — static rule shell
];

test('generator: every version literal is a deliberate, allowlisted freeze', () => {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const literals = [...src.matchAll(/version:\s*'([^']+)'/g)].map((m) => m[1]);
  const unexpected = literals.filter((v) => !FROZEN_VERSION_LITERALS.includes(v));
  assert.deepStrictEqual(
    unexpected,
    [],
    `gen-authorize-snapshot.js carries version literal(s) not in FROZEN_VERSION_LITERALS: ${unexpected.join(', ')}.\n` +
    'PingOne SKIPS import objects whose version is unchanged, so a literal on generated content makes the ' +
    'import a silent no-op (#1311, #1897). Use ver() — or, if the object is provably static, add the literal ' +
    'to the allowlist WITH a reason.',
  );
  // The allowlist must not outlive what it excuses.
  const stale = FROZEN_VERSION_LITERALS.filter((v) => !literals.includes(v));
  assert.deepStrictEqual(stale, [], `FROZEN_VERSION_LITERALS entries no longer present in the generator: ${stale.join(', ')}`);
});

// ── 2. request-attribute contract ────────────────────────────────────────────
//
// Derivation lives in p1azRequestContract.js so the gate, the parity verifier
// and any future caller read ONE definition instead of three regexes.

const { contract, PEP_SOURCES, loadSnapshot, requestAttributes } =
  require('./p1azRequestContract');

const pepSource = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sends = (src, name) => new RegExp(`\\b${name}\\s*[:=]`).test(src);

test('every request attribute a CONDITION reads has a defaultValue', () => {
  const c = contract();
  // Vacuity guard: a derivation that walked to zero would green-light everything.
  assert.ok(c.inert.length >= 20, `derivation looks broken — only ${c.inert.length} condition-read attributes found`);

  assert.deepStrictEqual(
    c.mustSend,
    [],
    `Request attribute(s) read by a CONDITION with NO defaultValue: ${c.mustSend.join(', ')}.\n` +
    'P1AZ cannot resolve an omitted attribute that has no default, and an unresolved attribute takes the ' +
    'WHOLE decision to INDETERMINATE — no statements, every rule unevaluated — which #1310 normalises to ' +
    'DENY. One such attribute therefore denies everything.\n' +
    'Fix in gen-authorize-snapshot.js by giving it an INERT default (the Amount / RarMaxAmount / ' +
    'TransactionType pattern), which fixes every present and future caller at once. Teaching one PEP to ' +
    'send it fixes only that PEP — the next caller reintroduces the bug.',
  );
});

test('any no-default attribute is sent by EVERY PEP, not just one of them', () => {
  const { mustSend } = contract();
  if (mustSend.length === 0) return; // the invariant above holds; nothing to enforce

  // Deliberately per-source. The previous version of this gate concatenated all
  // PEP sources into one blob, so an attribute sent by a SINGLE PEP satisfied it
  // for all four — which is how pingAuthorizeGuard.ts came to omit
  // TransactionType while the gate stayed green.
  const missing = [];
  for (const rel of PEP_SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const name of mustSend) {
      if (!new RegExp(`\\b${name}\\s*[:=]`).test(src)) missing.push(`${rel} omits ${name}`);
    }
  }
  assert.deepStrictEqual(missing, [], `PEP(s) omit a required request attribute:\n  ${missing.join('\n  ')}`);
});

test('every PEP sends every per-request attribute explicitly', () => {
  const { explicit } = contract();
  // Vacuity guard — the derivation shrinking to nothing would pass silently.
  assert.ok(explicit.length >= 5, `derivation looks broken — only ${explicit.length} explicit-send attributes`);

  // Decision 2026-09-09: all four PEPs send all of these, so a decision request
  // has ONE shape no matter which caller built it, and "this PEP has no value
  // for X" is asserted as '' rather than left to a default nobody reads.
  // '' is the required stand-in: ResourceOwnerMismatch is
  // `ResourceOwnerId NotEquals ''`, so a non-empty sentinel would fire the
  // resource-owner DENY on every request. Every other condition over these
  // compares with Equals against a non-empty constant, so '' is inert there too.
  const missing = [];
  for (const rel of PEP_SOURCES) {
    const src = pepSource(rel);
    for (const name of explicit) if (!sends(src, name)) missing.push(`${rel} omits ${name}`);
  }
  assert.deepStrictEqual(
    missing,
    [],
    `PEP(s) do not send every per-request attribute:\n  ${missing.join('\n  ')}\n` +
    "Send it explicitly — '' when this caller has no real value. NEVER a non-empty sentinel for " +
    'ResourceOwnerId: its condition is NotEquals \'\', so \'none\' fires the resource-owner DENY.',
  );
});

test('the PEP source list still points at files that exist', () => {
  // The per-PEP gate silently weakens if a source is renamed away, so pin it.
  for (const rel of PEP_SOURCES) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `PEP_SOURCES names a missing file: ${rel}`);
  }
});

test('the exempt attributes stay exempt for the reason recorded, not by accident', () => {
  const objects = loadSnapshot();
  const conditionBlob = JSON.stringify(objects.filter((o) => o && o.type === 'CONDITION'));
  const byName = Object.fromEntries(requestAttributes(objects).map((o) => [o.name, o]));
  // TokenKid is deliberately NOT sent (reportable-only; the PEP sends the
  // derived TokenKidKnown instead) — safe only while no condition reads it.
  if (byName.TokenKid) {
    assert.ok(!conditionBlob.includes(byName.TokenKid.id),
      'A CONDITION now reads TokenKid, but the gateway deliberately does not send it (it sends TokenKidKnown). ' +
      'Either send TokenKid or key the condition on TokenKidKnown.');
  }
});
