#!/usr/bin/env node
'use strict';

/**
 * Merges the MCP amount-band rules INTO an exported PingOne Authorize snapshot,
 * producing a package that can be imported and published without replacing the
 * environment's policy tree.
 *
 *   node snapshots/merge-mcp-amount-bands.js <export.json> [out.json]
 *
 * WHY A MERGER AND NOT A STANDALONE PACKAGE
 *
 * A P1AZ publish replaces the ENTIRE authorization version — it does not merge
 * policy sets. An earlier standalone package imported cleanly, and publishing it
 * made its lone root set the whole tree: every MCP audience / actor-chain /
 * bypass / tier / group rule stopped being evaluated, and a $50 call with no
 * audience and no actor went from DENY to PERMIT. Recovered by restoring the
 * previous version.
 *
 * So the only safe shape is: export the live tree, add to it, re-import, publish.
 * That is what this script does. It never creates a root PolicySet.
 *
 * WHAT IT ADDS (into the existing MCP Delegation policy, not a new one)
 *
 *   attribute   UseCaseId — the environment has none. Name must match the
 *               parameter key PingGateway sends (p1az-decision.groovy).
 *   conditions  four, each guarded by the export's own IsMcpFirstToolRequest and
 *               reusing its existing amount conditions rather than restating
 *               thresholds — so the bands stay defined in exactly one place.
 *   statements  two new ones (consent + deny). NOT reused: the environment's
 *               HITL_CONSENT and tier-amount statements are `shared: false` and
 *               already owned by rules in the Transaction policy; citing them
 *               from a second rule fails the import with "private entity has
 *               multiple parents". The step-up statement IS reused because it is
 *               already shared: true.
 *   rules       four, appended to the MCP Delegation policy ahead of its
 *               catch-all permit.
 *
 * Codes are what the readers classify (authorizeObligations.js / .ts /
 * p1az-decision.groovy), so the new statements carry the SAME codes as the ones
 * they parallel: step-up-required, HITL_CONSENT, mcp-tier-amount-exceeded.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const src = process.argv[2];
if (!src) {
  console.error('usage: node snapshots/merge-mcp-amount-bands.js <export.json> [out.json]');
  process.exit(1);
}
const out = process.argv[3] || path.join(__dirname, 'mcp-amount-bands.merged.snapshot.json');
const pkg = JSON.parse(fs.readFileSync(src, 'utf8'));

// ── Locate what we depend on, by NAME, and fail loudly if absent ─────────────
// Ids differ between environments and have drifted before; names are what the
// policy authors maintain. A missing dependency must stop the build, never
// produce a package that imports and silently does nothing.
// Accepts several candidate names so the merger keeps working across the
// Super Banking → AI Demo rename below, in either direction.
const byName = (type, ...names) => {
  for (const name of names) {
    const hit = pkg.find((o) => o && o.type === type && o.name === name);
    if (hit) return hit;
  }
  throw new Error(`export is missing ${type} "${names[0]}" — cannot merge safely`);
};

const A = {
  Amount: byName('ATTRIBUTE', 'Amount').id,
  Acr: byName('ATTRIBUTE', 'Acr').id,
  HitlApproved: byName('ATTRIBUTE', 'HitlApproved').id,
};
const C = {
  IsMcp: byName('CONDITION', 'IsMcpFirstToolRequest').id,
  IsLarge: byName('CONDITION', 'IsLargeTransaction').id,       // Amount > 2000
  IsHighValue: byName('CONDITION', 'IsHighValueTransaction').id, // Amount > 500
  IsConsent: byName('CONDITION', 'IsConsentTransaction').id,   // Amount > 250
  HasMfa: byName('CONDITION', 'HasMFAAuthentication').id,
};
const S = {
  StepUp: byName('Statement', 'Step-Up MFA Required'),                 // shared: true
  McpDenied: byName('Statement', 'MCP Tool Authorization Denied'),     // shared: true
};
for (const [k, v] of Object.entries(S)) {
  if (!v.shared) throw new Error(`statement "${v.name}" is not shared — citing it from a new rule would fail the import`);
}
const mcpPolicy = byName('Policy',
  'AI Demo MCP Delegation Authorization',
  'Super Banking MCP Delegation Authorization');

// ── Rename the containers: "Super Banking" is the bootstrap's name, not the
// demo's. Safe because the importer matches on ID — the objects are updated in
// place, not duplicated. Only the three container names change; rule, condition
// and statement names are untouched, and so are all ids.
const RENAMES = [
  ['PolicySet', 'Super Banking Policies', 'AI Demo Policies'],
  ['Policy', 'Super Banking Transaction Authorization', 'AI Demo Transaction Authorization'],
  ['Policy', 'Super Banking MCP Delegation Authorization', 'AI Demo MCP Delegation Authorization'],
];
const renamed = [];
for (const [type, from, to] of RENAMES) {
  const obj = pkg.find((o) => o && o.type === type && o.name === from);
  if (obj) {
    obj.name = to;
    if (typeof obj.description === 'string') {
      obj.description = obj.description.split('Super Banking').join('AI Demo');
    }
    renamed.push(`${type}: "${from}" → "${to}"`);
  }
}

// ── New objects ──────────────────────────────────────────────────────────────
const NEW = {
  attrUseCase: randomUUID(),
  condDeny: randomUUID(),
  condStepUp: randomUUID(),
  condConsent: randomUUID(),
  condDecoupled: randomUUID(),
  stmtConsent: randomUUID(),
  stmtDeny: randomUUID(),
  ruleDeny: randomUUID(),
  ruleStepUp: randomUUID(),
  ruleDecoupled: randomUUID(),
  ruleConsent: randomUUID(),
};

const ref = (id) => ({ reference: { id } });
const cmp = (attrId, op, value) => ({
  comparison: { left: { attribute: { id: attrId } }, op, right: { constant: { value } } },
});
const not = (c) => ({ not: { condition: c } });

const condition = (id, name, description, cond) => ({
  objectType: 'ConditionDefinition',
  condition: cond,
  description,
  fullName: name,
  id,
  name,
  numberOfChildren: null,
  parentId: null,
  type: 'CONDITION',
  version: randomUUID(),
});

const rule = (id, name, description, statements, effectSettings, cond) => ({
  id,
  version: randomUUID(),
  targets: [],
  name,
  shared: false,
  disabled: false,
  condition: cond,
  effectSettings,
  statements,
  description,
  type: 'Rule',
});

const additions = {
  attributes: [{
    objectType: 'AttributeDefinition',
    defaultValue: 'none',
    description:
      'Business context the call was initiated under, forwarded by PingGateway from the BFF\'s '
      + 'X-Use-Case-Id header. Lets policy gate on INTENT rather than amount — the decoupled-approval '
      + '(CIBA) demo is amount-independent by design ($150), so no amount band would catch it. Used '
      + 'only to REQUIRE a gate, never to waive one: a missing or forged value cannot weaken a '
      + 'decision. Default \'none\' keeps the rule inert when the header is absent.',
    fullName: 'UseCaseId',
    id: NEW.attrUseCase,
    name: 'UseCaseId',
    numberOfChildren: null,
    parentId: null,
    repetitionSource: null,
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    type: 'ATTRIBUTE',
    valueProcessor: null,
    valueSchema: null,
    valueType: 'STRING',
    version: randomUUID(),
  }],

  conditions: [
    condition(NEW.condDeny, 'McpAmountExceedsDenyLimit',
      'MCP request whose Amount trips the existing IsLargeTransaction band (> $2,000). Reuses that '
      + 'condition rather than restating the threshold, so the ceiling stays defined in one place.',
      { and: { conditions: [ref(C.IsMcp), ref(C.IsLarge)] } }),

    condition(NEW.condStepUp, 'McpAmountRequiresStepUp',
      'MCP request over the existing IsHighValueTransaction band (> $500) where the user has NOT '
      + 'completed MFA. Returning with Acr=Multi_Factor stops matching, which is how a completed '
      + 'step-up discharges the gate. This is the MCP-context twin of RequiresStepUp, which is '
      + 'additionally scoped to transfer/withdrawal TransactionType and so never fires on the MCP path.',
      { and: { conditions: [ref(C.IsMcp), ref(C.IsHighValue), not(ref(C.HasMfa))] } }),

    condition(NEW.condConsent, 'McpAmountRequiresHitlConsent',
      'MCP request over the existing IsConsentTransaction band (> $250) with no verified HITL '
      + 'receipt. A retry carrying HitlApproved=true — set by PingGateway only after verifying the '
      + 'receipt against the HITL service — stops matching, which discharges the gate. Compared '
      + 'against the string "true", matching how the existing RequiresHitlConsent reads it.',
      { and: { conditions: [ref(C.IsMcp), ref(C.IsConsent), cmp(A.HitlApproved, 'NotEquals', 'true')] } }),

    condition(NEW.condDecoupled, 'McpRequiresDecoupledApproval',
      'MCP request initiated under the decoupled-approval (CIBA) use case. Deliberately has NO '
      + 'amount term: CIBA models "this sensitive, agent-initiated action needs out-of-band '
      + 'approval", not a dollar gate, which is why the demo amount is a small $150 that no band '
      + 'would catch.',
      { and: { conditions: [ref(C.IsMcp), cmp(NEW.attrUseCase, 'Equals', 'UC22'), not(ref(C.HasMfa))] } }),
  ],

  statements: [
    {
      id: NEW.stmtConsent,
      version: randomUUID(),
      name: 'MCP Consent Required — Amount Band',
      description:
        'Consent obligation for an amount-gated MCP tool call. A separate statement from '
        + '"Transaction Consent Required" because that one is private to the Transaction policy\'s '
        + 'rule; the code is identical, and the code is what the BFF and both gateways classify.',
      shared: false,
      code: 'HITL_CONSENT',
      appliesTo: 'PERMIT',
      appliesIf: 'PATH_MATCHES',
      payload: `{"consentRequired": true, "message": "MCP tool call of \${{${A.Amount}}} requires explicit human approval before proceeding.", "amount": "{{${A.Amount}}}"}`,
      obligatory: false,
      attributes: [],
      services: [],
      type: 'Statement',
    },
    {
      id: NEW.stmtDeny,
      version: randomUUID(),
      name: 'MCP Denied — Amount Band Exceeded',
      description:
        'Hard deny for an MCP tool call over the ceiling. Separate from "MCP Denied — Tier Amount '
        + 'Exceeded" (private to the tier rule); same mcp-tier-amount-exceeded code so the deny '
        + 'reason surfaces identically in the BFF and Token Chain.',
      shared: false,
      code: 'mcp-tier-amount-exceeded',
      appliesTo: 'DENY',
      appliesIf: 'PATH_MATCHES',
      payload: `{"denied": true, "reason": "amount_limit_exceeded", "message": "MCP tool call of \${{${A.Amount}}} exceeds the maximum permitted amount.", "amount": "{{${A.Amount}}}"}`,
      obligatory: false,
      attributes: [],
      services: [],
      type: 'Statement',
    },
  ],

  rules: [
    rule(NEW.ruleDeny, 'MCP Deny — Amount Band Exceeded',
      'DENY an MCP tool call whose amount is over the ceiling. DenyOverrides means this wins over '
      + 'the obligation rules when several bands match at once. Pairs its own statement with the '
      + 'shared mcp-authorization-denied, matching every other MCP deny rule.',
      [NEW.stmtDeny, S.McpDenied.id],
      { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [ref(NEW.condDeny)] } } },
      { empty: {} }),

    rule(NEW.ruleStepUp, 'MCP Require Step-Up Over Amount Threshold',
      'PERMIT with a step-up obligation when an MCP tool call is over the step-up threshold and MFA '
      + 'has not been completed. Complements "MCP Require Step-Up for sensitive tools", which is '
      + 'keyed on tool name and ignores amount.',
      [S.StepUp.id],
      { type: 'unconditionalPermit' },
      { and: { conditions: [ref(NEW.condStepUp)] } }),

    rule(NEW.ruleDecoupled, 'MCP Require Decoupled Approval for the CIBA Use Case',
      'PERMIT with a step-up obligation when the call runs under the decoupled-approval use case, '
      + 'regardless of amount. The gateway emits the same 428 as any other step-up; the BFF resolves '
      + 'step_up_method=ciba from the use-case catalog on relay, so the agent drives the out-of-band '
      + 'flow rather than a device prompt.',
      [S.StepUp.id],
      { type: 'unconditionalPermit' },
      { and: { conditions: [ref(NEW.condDecoupled)] } }),

    rule(NEW.ruleConsent, 'MCP Require HITL Consent Over Amount Threshold',
      'PERMIT with a consent obligation when an MCP tool call is over the consent threshold and '
      + 'carries no verified receipt. An amount over the step-up threshold matches this rule too; '
      + 'the readers resolve that by precedence (step-up outranks consent), so no extra term is '
      + 'needed here. Complements "MCP Require HITL Consent for sensitive tools", which is keyed on '
      + 'tool name and ignores amount — without this, every create_transfer prompts regardless of '
      + 'amount, a $5 transfer included.',
      [NEW.stmtConsent],
      { type: 'unconditionalPermit' },
      { and: { conditions: [ref(NEW.condConsent)] } }),
  ],
};

// ── Splice into the package ──────────────────────────────────────────────────
// Order mirrors the export's own layout: attributes and conditions before the
// first separator; statements and rules after it, ahead of the policies.
const firstSep = pkg.findIndex((o) => o && o.type === 'SnapshotPackageFile$PackageSeparator');
if (firstSep < 0) throw new Error('export has no package separator — unexpected shape');
const firstPolicy = pkg.findIndex((o) => o && o.type === 'Policy');
if (firstPolicy < 0) throw new Error('export has no Policy — unexpected shape');

const merged = [
  ...pkg.slice(0, firstSep),
  ...additions.attributes,
  ...additions.conditions,
  ...pkg.slice(firstSep, firstPolicy),
  ...additions.statements,
  ...additions.rules,
  ...pkg.slice(firstPolicy),
];

// Append the new rules to the MCP policy, BEFORE its catch-all permit so the
// editor reads deny-then-obligation-then-permit like every other policy here.
const policy = merged.find((o) => o && o.type === 'Policy' && o.id === mcpPolicy.id);
const catchAllIdx = policy.children.findIndex((c) => {
  const r = merged.find((o) => o && o.type === 'Rule' && o.id === c.id);
  return r && r.name === 'MCP Permit Valid Tool Invocation';
});
const newChildren = [NEW.ruleDeny, NEW.ruleStepUp, NEW.ruleDecoupled, NEW.ruleConsent]
  .map((id) => ({ id, type: 'Rule' }));
policy.children = catchAllIdx < 0
  ? [...policy.children, ...newChildren]
  : [...policy.children.slice(0, catchAllIdx), ...newChildren, ...policy.children.slice(catchAllIdx)];

// ── Validate before writing: every failure mode we have actually hit ─────────
const ids = new Set(merged.filter((o) => o && o.id).map((o) => o.id));
const problems = [];

const collectRefs = (node, acc) => {
  if (!node || typeof node !== 'object') return acc;
  if (node.reference && node.reference.id) acc.add(node.reference.id);
  if (node.attribute && node.attribute.id) acc.add(node.attribute.id);
  for (const v of Object.values(node)) collectRefs(v, acc);
  return acc;
};
const refs = new Set();
for (const o of merged) collectRefs(o, refs);
for (const o of merged) {
  if (o && o.type === 'Rule') (o.statements || []).forEach((s) => refs.add(s));
  if (o && (o.type === 'Policy' || o.type === 'PolicySet')) (o.children || []).forEach((c) => refs.add(c.id));
}
for (const r of refs) if (!ids.has(r)) problems.push(`dangling reference: ${r}`);

const stmtParents = new Map();
for (const o of merged) {
  if (o && o.type === 'Rule') {
    for (const s of o.statements || []) stmtParents.set(s, (stmtParents.get(s) || 0) + 1);
  }
}
for (const [sid, n] of stmtParents) {
  const st = merged.find((o) => o && o.type === 'Statement' && o.id === sid);
  if (n > 1 && st && !st.shared) problems.push(`private statement "${st.name}" cited by ${n} rules`);
}

const roots = merged.filter((o) => o && o.type === 'PolicySet');
if (roots.length !== 1) problems.push(`expected exactly 1 PolicySet, found ${roots.length} — a second root would replace the tree on publish`);

const attrNames = merged.filter((o) => o && o.type === 'ATTRIBUTE').map((o) => o.name);
const dupes = attrNames.filter((n, i) => attrNames.indexOf(n) !== i);
if (dupes.length) problems.push(`duplicate attribute names: ${[...new Set(dupes)].join(', ')}`);

if (problems.length) {
  console.error('REFUSING TO WRITE — merged package is invalid:');
  for (const p of problems) console.error('  •', p);
  process.exit(1);
}

fs.writeFileSync(out, `${JSON.stringify(merged, null, 0)}\n`);
console.log(`Wrote ${out}`);
console.log(`  entries      ${merged.length} (was ${pkg.length}, +${merged.length - pkg.length})`);
console.log(`  policy sets  ${roots.length} — "${roots[0].name}" (same root id, no new root)`);
for (const r of renamed) console.log(`  renamed      ${r}`);
console.log(`  added to     "${policy.name}" → ${policy.children.length} rules`);
console.log('  validated    no dangling refs, no multi-parent private statements, no duplicate attribute names');
