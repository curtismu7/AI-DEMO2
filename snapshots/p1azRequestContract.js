'use strict';

/**
 * p1azRequestContract.js — the ONE derivation of what a P1AZ decision request
 * must carry, read from the snapshot rather than typed anywhere.
 *
 * TECH_DEBT 2026-08-17 asked for "a shared definition of the request contract"
 * so every caller (both gateway PEPs, the BFF service, the unattended-agent PEP,
 * the two live verifiers) builds from one place instead of each hand-assembling
 * `parameters` and drifting.
 *
 * ── The rule this encodes, and why it is the rule ────────────────────────────
 *
 * Live P1AZ answers INDETERMINATE for the WHOLE decision — no statements, every
 * rule unevaluated — when a CONDITION reads an attribute that resolves to
 * nothing. That is never a legitimate outcome in this demo, and #1310 normalises
 * it to DENY, so one unresolvable attribute denies everything.
 *
 * An attribute resolves when the request carries it OR when it has a
 * defaultValue. So the invariant that actually prevents the failure is:
 *
 *     every request-resolved attribute a CONDITION reads has a defaultValue
 *
 * This is the generalisation of two fixes already in the generator, both found
 * the expensive way: Amount (NUMBER, defaultValue null) made EVERY read
 * INDETERMINATE because read tools never send an amount — probed live
 * 2026-08-03; and RarMaxAmount got the identical treatment. Both were fixed by
 * giving the attribute an inert default, not by teaching callers to send it,
 * because a default fixes every present and future caller at once.
 *
 * ── On the empty string ──────────────────────────────────────────────────────
 *
 * `defaultValue: ''` IS a resolving default. The generator's AgentClass comment
 * claims otherwise ("P1AZ leaves an empty STRING unresolved"), but the repo's
 * own recorded live behaviour disproves it: TokenAudActual, TokenIss,
 * ResourceOwnerId and the three IntentToken* attributes all ship with `''`, no
 * PEP sends most of them on a given request, and those requests return clean
 * PERMITs live (TECH_DEBT 2026-08-18 baseline: $100 -> PERMIT). Were `''`
 * unresolvable, ResourceOwnerMismatch — which compares ResourceOwnerId against
 * `''` — could never evaluate and every decision would be INDETERMINATE.
 *
 * This matters because it is the difference between a 1-attribute and a
 * 7-attribute contract. Treating `''` as "no default" (as the first version of
 * the gate did) also implies a dangerous fix: sending a NON-EMPTY sentinel for
 * ResourceOwnerId would satisfy `ResourceOwnerId != ''` and fire the
 * resource-owner DENY on every request.
 */

const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');

/** Sources that build a P1AZ decision request. Keep in step with reality. */
const PEP_SOURCES = [
  'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts',
  'demo_mcp_gateway/src/pingAuthorizeGuard.ts',
  'demo_api_server/services/pingOneAuthorizeService.js',
  // The unattended-agent PEP: builds its own request (no session to borrow one
  // from), so it is a source this contract must know about.
  'demo_api_server/services/autonomousAuthorize.js',
];

function loadSnapshot(file = SNAPSHOT) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Attributes P1AZ resolves from the decision request body. */
function requestAttributes(objects) {
  return objects
    .filter((o) => o && o.type === 'ATTRIBUTE')
    .filter((o) => (o.resolvers || []).some((r) => r.attributeResolverType === 'request'));
}

/** An attribute resolves from its default when the request omits it. */
function hasDefault(attr) {
  return attr.defaultValue !== null && attr.defaultValue !== undefined;
}

/**
 * The attribute carries no VALUE of its own when the request omits it — either
 * no default at all, or the empty string. These are the per-request facts
 * (which token, whose resource, what intent), as opposed to attributes whose
 * default is a real inert value like 'none', false or 0.
 */
function isBlankDefault(attr) {
  return !hasDefault(attr) || attr.defaultValue === '';
}

/**
 * The contract: every request attribute, split by how it resolves.
 *
 * - `mustSend`  — read by a CONDITION and has NO default. The request MUST
 *                 carry it or the whole decision goes INDETERMINATE, so EVERY
 *                 PEP has to send it. This set should stay empty: the standing
 *                 fix is to give the attribute a default (the Amount pattern).
 * - `inert`     — read by a CONDITION but defaulted, so omitting it is safe and
 *                 the rule reading it simply stays inert.
 * - `explicit`  — read by a CONDITION and blank when omitted (no default, or
 *                 `''`). Resolvable, so omitting one cannot break a decision —
 *                 but it is a per-request fact, and a PEP that omits it is
 *                 asserting nothing rather than asserting "not applicable".
 *                 Every PEP sends all of these, by decision (2026-09-09), so
 *                 the request shape is uniform and reviewable across callers
 *                 instead of each PEP carrying a different subset.
 *                 The correct explicit value when a PEP has no real one is
 *                 `''` — never a non-empty sentinel. Every condition reading
 *                 these compares with `Equals <non-empty constant>` except
 *                 ResourceOwnerMismatch, which is `ResourceOwnerId NotEquals ''`
 *                 — so `''` keeps every one of them inert, while 'none' or
 *                 'n/a' would FIRE the resource-owner DENY on every request.
 * - `unread`    — no CONDITION reads it: reportable input only.
 */
function contract(objects = loadSnapshot()) {
  const conditionBlob = JSON.stringify(objects.filter((o) => o && o.type === 'CONDITION'));
  const attrs = requestAttributes(objects);
  const read = (a) => conditionBlob.includes(a.id);

  return {
    mustSend: attrs.filter((a) => read(a) && !hasDefault(a)).map((a) => a.name),
    explicit: attrs.filter((a) => read(a) && isBlankDefault(a)).map((a) => a.name),
    inert: attrs.filter((a) => read(a) && hasDefault(a)).map((a) => a.name),
    unread: attrs.filter((a) => !read(a)).map((a) => a.name),
    all: attrs.map((a) => a.name),
  };
}

module.exports = {
  SNAPSHOT,
  PEP_SOURCES,
  loadSnapshot,
  requestAttributes,
  hasDefault,
  isBlankDefault,
  contract,
};
