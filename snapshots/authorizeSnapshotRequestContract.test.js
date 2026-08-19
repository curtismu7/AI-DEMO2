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

/** The sources that build decision requests (PEPs + the BFF service). */
const PEP_SOURCES = [
  'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts',
  'demo_mcp_gateway/src/pingAuthorizeGuard.ts',
  'demo_api_server/services/pingOneAuthorizeService.js',
];

function requiredRequestAttributes() {
  const objects = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const conditions = objects.filter((o) => o && o.type === 'CONDITION');
  const conditionBlob = JSON.stringify(conditions);
  return objects
    .filter((o) => o && o.type === 'ATTRIBUTE')
    .filter((o) => (o.resolvers || []).some((r) => r.attributeResolverType === 'request'))
    .filter((o) => o.defaultValue === null || o.defaultValue === undefined || o.defaultValue === '')
    .filter((o) => conditionBlob.includes(o.id))
    .map((o) => o.name);
}

test('every no-default request attribute a CONDITION reads is sent by some PEP', () => {
  const required = requiredRequestAttributes();
  // Vacuity guard: the derivation walking to zero would green-light everything.
  assert.ok(required.length >= 5, `derivation looks broken — only ${required.length} required attributes found`);

  const pepBlob = PEP_SOURCES
    .map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8'))
    .join('\n');

  const unsent = required.filter((name) => !new RegExp(`\\b${name}\\s*[:=]`).test(pepBlob));
  assert.deepStrictEqual(
    unsent,
    [],
    `Policy condition(s) read request attribute(s) no PEP sends: ${unsent.join(', ')}.\n` +
    'Live P1AZ resolves a missing no-default attribute to INDETERMINATE — never a legitimate outcome ' +
    'in this demo. Fix by sending the attribute from the PEP (see buildAuthorizeParameters), or by ' +
    'giving it a defaultValue in gen-authorize-snapshot.js (the Amount pattern).',
  );
});

test('the exempt attributes stay exempt for the reason recorded, not by accident', () => {
  const objects = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const conditionBlob = JSON.stringify(objects.filter((o) => o && o.type === 'CONDITION'));
  const byName = Object.fromEntries(objects.filter((o) => o && o.type === 'ATTRIBUTE').map((o) => [o.name, o]));
  // TokenKid is deliberately NOT sent (reportable-only; the PEP sends the
  // derived TokenKidKnown instead) — safe only while no condition reads it.
  if (byName.TokenKid) {
    assert.ok(!conditionBlob.includes(byName.TokenKid.id),
      'A CONDITION now reads TokenKid, but the gateway deliberately does not send it (it sends TokenKidKnown). ' +
      'Either send TokenKid or key the condition on TokenKidKnown.');
  }
});
