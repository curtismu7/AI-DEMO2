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

// The export's versions AS READ, before anything below mutates them. The
// validation pass compares against this to prove every edited object will
// actually import rather than being skipped as unchanged.
const exportVersions = new Map(
  pkg.filter((o) => o && o.id && typeof o.version === 'string').map((o) => [o.id, o.version]),
);
// Deep copy — the objects below are mutated in place, so a shallow reference
// would compare an edited object against itself and never see a difference.
const exportObjects = new Map(
  pkg.filter((o) => o && o.id).map((o) => [o.id, JSON.parse(JSON.stringify(o))]),
);

const touched = new Set();
const touch = (o) => {
  if (o && typeof o === 'object') {
    o.version = randomUUID();
    if (o.id) touched.add(o.id);
  }
  return o;
};

// ── Generator-owned objects win over the export ──────────────────────────────
// This script merges INTO a live export, so every object it does not create is
// whatever the cloud already had. For most objects that is exactly right. For
// the handful that `gen-authorize-snapshot.js` OWNS — derived from the banking
// manifest, not hand-edited in the console — inheriting the cloud's copy silently
// discards whatever the generator just fixed.
//
// That is not hypothetical. On 2026-08-03 the deny band was repointed at
// ExceedsTierAmountCap and the tier condition itself was given a NOT-fallback so
// an absent UserTier resolves to the capped tier. The merger inherited the live
// ExceedsTierAmountCap (no fallback), so the produced package would have fixed
// UC21 while OPENING a fail-open: with no UserTier sent, neither tier branch
// matched, the condition was false, and an over-cap amount was denied by nothing.
// It had to be hand-patched onto the export to ship.
//
// Overlaying them here makes the package reproducible from the repo instead of
// depending on someone remembering to splice a condition in by hand.
const GENERATED_SNAPSHOT = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');

// Name -> the fields the generator owns. Only these are copied, so console-side
// edits to anything else on the object survive.
const GENERATOR_OWNED = {
  // Tier ceilings + the default-tier fallback, generated from the banking
  // manifest tiers block. The whole point of generating them is that the cloud
  // cannot disagree with the manifest.
  ExceedsTierAmountCap: ['condition', 'description'],
  IsStandardTier: ['condition', 'description'],
  IsTierRestrictedTool: ['condition', 'description'],
  // defaultValue 0 — an unresolved NUMBER makes the WHOLE decision INDETERMINATE,
  // and READ tools never send Amount. Inheriting a null default from an older
  // export would silently re-break every read.
  //
  // `description` deliberately NOT owned here: the generated copy still says
  // "Super Banking BFF", so overlaying it would fight the de-brand pass below —
  // overlay pulls the old wording in, de-brand converts it back, content nets to
  // zero and the version moves twice. The validation pass catches that as
  // pointless churn. The three tier conditions above carry no "Super Banking"
  // wording, so owning their descriptions is safe (checked).
  Amount: ['defaultValue'],
};

let overlaid = 0;
{
  if (!fs.existsSync(GENERATED_SNAPSHOT)) {
    throw new Error(`generated snapshot not found at ${GENERATED_SNAPSHOT} — run npm run snapshot:generate first`);
  }
  const generated = JSON.parse(fs.readFileSync(GENERATED_SNAPSHOT, 'utf8'));
  for (const [name, fields] of Object.entries(GENERATOR_OWNED)) {
    const gen = generated.find((o) => o && o.name === name);
    const cur = pkg.find((o) => o && o.name === name);
    // Fail loudly rather than skip: a missing object here means the export or the
    // generated file is not the shape this script was written against, and a
    // quiet skip is how the tier fix went missing in the first place.
    if (!gen) throw new Error(`generated snapshot has no "${name}" — cannot overlay`);
    if (!cur) throw new Error(`export has no "${name}" — cannot overlay`);
    if (gen.id !== cur.id) {
      throw new Error(`"${name}" id differs (generated ${gen.id} vs export ${cur.id}) — refusing to overlay across trees`);
    }
    // PingOne normalises scalars on import — `defaultValue: 0` comes back as the
    // STRING '0'. Comparing raw would mark Amount changed on every single run and
    // re-version it forever, which is the churn the validation pass below warns
    // about. Compare primitives by their string form; objects/arrays deeply.
    const differs = (a, b) => (
      (a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')
        ? JSON.stringify(a) !== JSON.stringify(b)
        : String(a) !== String(b)
    );
    const changed = fields.filter((f) => differs(cur[f], gen[f]));
    if (changed.length === 0) continue;
    for (const f of changed) cur[f] = JSON.parse(JSON.stringify(gen[f]));
    touch(cur);            // version must move or PingOne skips the overlay
    overlaid += 1;
  }
}

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

// ⚠️ PingOne SKIPS an object whose version is unchanged. Objects this script
// CREATES always import (fresh id), but an object it EDITS in place keeps the
// version it carried in the export — so the edit is a silent no-op in the cloud:
// the file is right, the import reports success, and the live policy keeps the
// old content with nothing to indicate it.
//
// That is not hypothetical. The 2026-08-03 import applied all 61 new objects and
// NONE of the edits. The two superseded rules stayed enabled live, so they fired
// alongside the per-vertical replacements and every gated call came back with a
// DUPLICATED HITL_CONSENT statement; the policy's children never gained the new
// rules either. Probed live against env 01d89b06.
//
// Call touch() on anything mutated below. randomUUID matches what this script
// already mints for new objects — a content hash would buy nothing here, since
// the script is deliberately non-deterministic (see the idempotency note: every
// run mints fresh UUIDs and strips the previous run by NAME).
const A = {
  Amount: byName('ATTRIBUTE', 'Amount').id,
  ToolName: byName('ATTRIBUTE', 'ToolName').id,
  Acr: byName('ATTRIBUTE', 'Acr').id,
  HitlApproved: byName('ATTRIBUTE', 'HitlApproved').id,
};
const C = {
  IsMcp: byName('CONDITION', 'IsMcpFirstToolRequest').id,
  IsLarge: byName('CONDITION', 'IsLargeTransaction').id,       // Amount > 2000 (flat, tier-blind)
  // The per-tier ceiling. The MCP deny band uses THIS, not IsLargeTransaction:
  // a flat $2,000 deny ignores tier, so it denied a PrivateBanking caller at
  // $2,500 exactly like a Standard one and UC21's whole "same amount, different
  // tier" story died in the cloud. Probed live 2026-08-03 — both tiers DENY at
  // $2,500. ExceedsTierAmountCap now treats an unknown/absent UserTier as the
  // capped default tier, so swapping to it does not open a hole for requests
  // that send no tier.
  ExceedsTierCap: byName('CONDITION', 'ExceedsTierAmountCap').id,
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
    renamed.push(`${type}: "${from}" → "${to}"`);
  }
}

// ── De-brand: the policies are not banking-specific ──────────────────────────
// "Super Banking" is product branding left over from the bootstrap; these rules
// serve every vertical (banking, healthcare, retail, university, government,
// manufacturing, investment, workforce, sporting-goods). Swept out of names,
// descriptions and payloads.
//
// EXCEPT where it is a PROPER NOUN. PingOne resources really are named
// "Super Banking MCP Gateway", "Super Banking PingGateway MCP" etc. in
// scope-topology.json, and HasValidMcpAudience's description cites them by name.
// Rewriting those would make the description describe resources that do not
// exist. The protected list is READ from scope-topology.json rather than
// hardcoded, so it cannot drift from the actual resource names.
//
// The word "banking" as a VERTICAL is untouched — it is a domain, not branding.
// "Authorizes Super Banking banking transactions" correctly becomes
// "Authorizes AI Demo banking transactions".
const sot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scope-topology.json'), 'utf8'));
const protectedNames = Object.keys(sot.resources || {})
  .filter((n) => n.includes('Super Banking'))
  .sort((a, b) => b.length - a.length); // longest first, so prefixes cannot shadow

const debrand = (text) => {
  if (typeof text !== 'string' || !text.includes('Super Banking')) return { text, changed: false };
  const masks = [];
  let masked = text;
  protectedNames.forEach((name) => {
    while (masked.includes(name)) {
      const token = ` RES${masks.length} `;
      masks.push(name);
      masked = masked.replace(name, token);
    }
  });
  let outText = masked.split('Super Banking').join('AI Demo');
  masks.forEach((name, i) => { outText = outText.split(` RES${i} `).join(name); });
  return { text: outText, changed: outText !== text };
};

let debranded = 0;
let protectedHits = 0;
for (const o of pkg) {
  if (!o || typeof o !== 'object') continue;
  for (const field of ['name', 'description', 'payload']) {
    const before = o[field];
    if (typeof before !== 'string') continue;
    const { text, changed } = debrand(before);
    // De-branding EDITS the exported object, so it needs a fresh version like
    // every other in-place mutation here — otherwise the rename imports as a
    // no-op and the console keeps showing the old wording. Caught by the
    // version/content guard below rather than by anyone noticing.
    if (changed) { o[field] = text; debranded += 1; touch(o); }
    if (text.includes('Super Banking')) protectedHits += 1;
  }
}

// ── New objects ──────────────────────────────────────────────────────────────
const NEW = {
  attrUseCase: randomUUID(),
  attrVertical: randomUUID(),
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
  }, {
    objectType: 'AttributeDefinition',
    defaultValue: 'none',
    description:
      'Which vertical the call was made in — banking, healthcare, retail, university, government, '
      + 'manufacturing, investment, workforce, sporting-goods. PingGateway has ALWAYS sent this '
      + '(p1az-decision.groovy reads X-Active-Vertical and sets parameters.Vertical), but no '
      + 'attribute defined it, so the PDP discarded it on every request and policy could not '
      + 'distinguish one vertical from another. Defining it is what makes per-vertical rules '
      + 'possible; no rule references it yet. Default \'none\' keeps any future rule inert when the '
      + 'header is absent.',
    fullName: 'Vertical',
    id: NEW.attrVertical,
    name: 'Vertical',
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
      'MCP request whose Amount exceeds the CALLER\'S TIER ceiling (ExceedsTierAmountCap: '
      + 'Standard $2,000, PrivateBanking $50,000). Reuses that condition rather than restating any '
      + 'threshold, so the ceilings stay defined in one place — the banking manifest.',
      { and: { conditions: [ref(C.IsMcp), ref(C.ExceedsTierCap)] } }),

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
      // The constant must be the useCaseId slug the BFF sends and p1az-decision.groovy
      // forwards verbatim as UseCaseId ('ciba-out-of-band-approval', useCases.js) —
      // NOT the display label "UC22", which never appears in the decision request.
      { and: { conditions: [ref(C.IsMcp), cmp(NEW.attrUseCase, 'Equals', 'ciba-out-of-band-approval'), not(ref(C.HasMfa))] } }),
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

// ── Per-vertical obligation rules ────────────────────────────────────────────
// The gated tools were spread across two cross-vertical rules ("MCP Require
// Step-Up for sensitive tools", "MCP Require HITL Consent for sensitive tools"),
// so nothing in the console said which vertical a gate belonged to. Split so each
// vertical's gate carries that vertical's name.
//
// The conditions stay keyed on TOOL NAME and are deliberately NOT gated on the
// Vertical attribute. Every tool below is exclusive to one vertical (verified by
// grepping demo_api_server/config/verticals), so the tool name already implies
// the vertical — while `Vertical` can arrive empty (the BFF omits it when falsy;
// the Node gateway sends `vertical ?? ''`). Adding `Vertical Equals x` would
// therefore introduce a way for a real gate to stop firing. Naming changes;
// enforcement does not.
//
// create_transfer / create_deposit / create_withdrawal are defined by EVERY
// vertical, so they keep one shared rule — nine identical copies would be nine
// things to keep in step, not nine insights.
const STEP_UP_BY_VERTICAL = {
  retail: ['cash_out_store_credit'],
  investment: ['large_trade'],
  government: ['release_record'],
  healthcare: ['release_records'],
  university: ['release_transcript'],
  manufacturing: ['release_work_order'],
  workforce: ['submit_expense'],
  'sporting-goods': ['transfer_membership'],
  // Banking's own high-value action. Its $300/$600 chips are AMOUNT-gated via
  // create_transfer; this is the tool-keyed gate, so banking no longer relies on
  // the shared create_deposit/create_withdrawal rule for step-up.
  banking: ['create_wire_transfer'],
  // United Airlines Phase 2 — cancelling a booked seat and refunding it is
  // irreversible, so it needs proof the passenger is present (MFA), which a
  // consent receipt deliberately cannot supply.
  airlines: ['cancel_airline_reservation'],
  // Admin dashboard agent. Every one of these was UNGATED: the agent could
  // delete a customer, reset their password, freeze an account or adjust a
  // balance with no step-up at the PDP — admin:delete scope and nothing else
  // standing in front of it. Step-up (not consent) because these are operator
  // actions: what is missing is proof the admin is present, not a second human.
  admin: ['freeze_account', 'adjust_balance', 'reset_customer_password'],
};
const STEP_UP_SHARED = ['create_deposit', 'create_withdrawal'];

const CONSENT_BY_VERTICAL = {
  healthcare: ['book_appointment', 'sensitive_patient_records'],
  retail: ['checkout', 'sensitive_order_history'],
  'sporting-goods': ['extend_rental', 'sensitive_membership_details'],
  banking: ['get_sensitive_account_details'],
  workforce: ['request_time_off', 'sensitive_payroll_details'],
  investment: ['sensitive_holdings'],
  university: ['sensitive_student_finance'],
  manufacturing: ['sensitive_supplier_contract'],
  government: ['sensitive_tax_record'],
  // Deleting a customer is irreversible, so it needs a second human — not just
  // proof the operator is present. The other three admin writes are recoverable
  // and take step-up instead.
  admin: ['delete_customer'],
  // United Airlines, Phase 2. Deliberately NOT get_airline_bookings: gating the
  // only reservations lookup would prompt on every "show my reservations".
  // sensitive_airline_bookings is the separate consent-gated read, mirroring the
  // split healthcare already has (view_records plain, sensitive_patient_records
  // gated). get_flight_status and check_seat_availability stay open.
  airlines: ['sensitive_airline_bookings'],
};
// sensitive_investment_holdings is in the policy's consent list but no vertical
// config defines it — keep it on the shared rule rather than guessing an owner.
const CONSENT_SHARED = ['create_transfer', 'sensitive_investment_holdings'];

const label = (v) => v.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const anyTool = (tools) => (tools.length === 1
  ? cmp(A.ToolName, 'Equals', tools[0])
  : { or: { conditions: tools.map((t) => cmp(A.ToolName, 'Equals', t)) } });

const verticalRules = [];
const verticalConditions = [];

const addVerticalRule = (kind, vertical, tools) => {
  const condId = randomUUID();
  const ruleId = randomUUID();
  const isStepUp = kind === 'stepUp';
  const who = vertical ? `${label(vertical)} ` : '';
  const scope = vertical
    ? `the ${label(vertical)} vertical`
    : 'every vertical (these tools are defined by all of them)';

  verticalConditions.push(condition(condId,
    `Requires${isStepUp ? 'StepUp' : 'HitlConsent'}${vertical ? label(vertical).replace(/ /g, '') : 'Shared'}`,
    `${isStepUp ? 'Step-up' : 'Consent'} gate for ${scope}: ToolName is one of `
    + `${tools.join(', ')}${isStepUp ? ' AND the user has NOT completed MFA' : ' AND HitlApproved is not true'}. `
    + 'Keyed on tool name, not on the Vertical attribute — these tools are exclusive to this '
    + 'vertical, and Vertical can arrive empty, which would silently drop the gate.',
    { and: { conditions: [
      anyTool(tools),
      isStepUp ? not(ref(C.HasMfa)) : cmp(A.HitlApproved, 'NotEquals', 'true'),
    ] } }));

  verticalRules.push(rule(ruleId,
    `AI Demo ${who}— Require ${isStepUp ? 'Step-Up' : 'HITL Consent'}`,
    `PERMIT with a${isStepUp ? ' step-up' : ' consent'} obligation for ${scope}. Split out of the `
    + `single cross-vertical "${isStepUp ? 'MCP Require Step-Up' : 'MCP Require HITL Consent'} for `
    + 'sensitive tools" rule so each vertical\'s gate is identifiable in the console. Same tools, '
    + 'same obligation, same enforcement.',
    [isStepUp ? S.StepUp.id : NEW.stmtVerticalConsent],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(condId)] } }));
};

NEW.stmtVerticalConsent = randomUUID();
for (const [v, tools] of Object.entries(STEP_UP_BY_VERTICAL)) addVerticalRule('stepUp', v, tools);
addVerticalRule('stepUp', null, STEP_UP_SHARED);
for (const [v, tools] of Object.entries(CONSENT_BY_VERTICAL)) addVerticalRule('consent', v, tools);
addVerticalRule('consent', null, CONSENT_SHARED);

// One shared consent statement for all the new consent rules — shared:true because
// many rules cite it, and a private statement may have only one parent.
additions.statements.push({
  id: NEW.stmtVerticalConsent,
  version: randomUUID(),
  name: 'MCP Consent Required — Sensitive Tool',
  description:
    'Consent obligation for a tool-gated MCP call, cited by every per-vertical consent rule. '
    + 'shared:true because a private statement may have only one parent rule. Same HITL_CONSENT '
    + 'code the readers already classify.',
  shared: true,
  code: 'HITL_CONSENT',
  appliesTo: 'PERMIT',
  appliesIf: 'PATH_MATCHES',
  payload: `{"consentRequired": true, "message": "Tool '{{${A.ToolName}}}' requires human approval before proceeding.", "toolName": "{{${A.ToolName}}}"}`,
  obligatory: false,
  attributes: [],
  services: [],
  type: 'Statement',
});
additions.conditions.push(...verticalConditions);
additions.rules.push(...verticalRules);

// Supersede the two cross-vertical rules: disabled, but left in the policy so the
// console shows what replaced them rather than them just vanishing.
for (const name of ['MCP Require Step-Up for sensitive tools', 'MCP Require HITL Consent for sensitive tools']) {
  const r = pkg.find((o) => o && o.type === 'Rule' && o.name === name);
  if (r) {
    r.disabled = true;
    r.description = `SUPERSEDED by the per-vertical rules — kept disabled for traceability. ${r.description}`;
    // Without this the rule stays ENABLED in the cloud and fires alongside its
    // per-vertical replacement — the duplicated HITL_CONSENT seen live 2026-08-03.
    touch(r);
  }
}

// ── Idempotency: strip any previous run's objects before adding ─────────────
// Every run mints fresh UUIDs, so merging into an export that ALREADY contains a
// previous merge would add a parallel set of rules rather than updating them —
// the policy would gate twice and the console would show duplicates. Objects
// this script owns are identified by NAME (the ids differ every run), removed
// from the package and from the MCP policy's children, then re-added below.
const OWNED_PREFIXES = ['AI Demo '];
const OWNED_NAMES = new Set([
  ...additions.conditions.map((c) => c.name),
  ...additions.statements.map((st) => st.name),
  ...additions.attributes.map((a) => a.name),
  ...additions.rules.map((r) => r.name),
]);
const ownsObject = (o) => {
  if (!o || !o.name) return false;
  if (OWNED_NAMES.has(o.name)) return true;
  return o.type === 'Rule' && OWNED_PREFIXES.some((pre) => o.name.startsWith(pre));
};
const strippedIds = new Set(pkg.filter(ownsObject).map((o) => o.id));
if (strippedIds.size) {
  for (let i = pkg.length - 1; i >= 0; i -= 1) if (strippedIds.has(pkg[i].id)) pkg.splice(i, 1);
  for (const o of pkg) {
    if ((o.type === 'Policy' || o.type === 'PolicySet') && Array.isArray(o.children)) {
      const before = o.children.length;
      o.children = o.children.filter((c) => !strippedIds.has(c.id));
      // Only re-version if this policy actually lost a child — touching an
      // untouched policy would churn its version on every run for no reason.
      if (o.children.length !== before) touch(o);
    }
  }
}

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
const newChildren = [NEW.ruleDeny, NEW.ruleStepUp, NEW.ruleDecoupled, NEW.ruleConsent,
  ...verticalRules.map((r) => r.id)]
  .map((id) => ({ id, type: 'Rule' }));
policy.children = catchAllIdx < 0
  ? [...policy.children, ...newChildren]
  : [...policy.children.slice(0, catchAllIdx), ...newChildren, ...policy.children.slice(catchAllIdx)];
// The policy now cites rules it did not cite in the export. Skipping this leaves
// the new rules orphaned in the cloud: imported, but attached to nothing.
touch(policy);

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

// Version/content agreement, checked against the export's own CONTENT — never
// against `touched`. Deriving "was this edited?" from the same bookkeeping that
// performs the edit makes the guard vacuous: delete the touch() calls and the
// check silently has nothing to look at. (Confirmed — an earlier version of this
// block passed with every touch() removed.) Comparing content is independent of
// whether anyone remembered to call touch().
//
// This is the check that would have caught the 2026-08-03 half-import, where all
// 61 new objects landed and none of the edits did.
// ⚠️ Stable, DEEP serialisation. The first version of this used
// `JSON.stringify(rest, Object.keys(rest).sort())` — but an array as the second
// argument to JSON.stringify is a key ALLOWLIST applied at EVERY level, not a
// sort order. Nested keys (`or`, `and`, `not`, `comparison` inside `condition`)
// were therefore stripped from both sides, so the two always matched and the
// guard was blind to exactly the changes that matter most: condition logic.
// It could only ever see top-level scalars like `description` and `disabled`.
// Caught when the generator overlay legitimately rewrote a condition and this
// reported the object as unedited.
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};
const bodyOf = (o) => {
  const { version, ...rest } = o;
  return stable(rest);
};
for (const o of merged) {
  if (!o || !o.id) continue;
  const wasVersion = exportVersions.get(o.id);
  if (!wasVersion) continue;                       // object we created — always imports
  const original = exportObjects.get(o.id);
  const changed = bodyOf(o) !== bodyOf(original);
  if (changed && wasVersion === o.version) {
    problems.push(
      `edited object "${o.name || o.id}" kept its export version ${wasVersion} — PingOne would SKIP it, `
      + 'so the edit would never reach the cloud. Call touch() wherever it is mutated.',
    );
  }
  if (!changed && wasVersion !== o.version) {
    problems.push(
      `unedited object "${o.name || o.id}" changed version ${wasVersion} -> ${o.version} — pointless `
      + 're-import, and it makes a real change indistinguishable from noise.',
    );
  }
}

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
console.log(`  de-branded   ${debranded} field(s); ${protectedHits} kept (real PingOne resource names)`);
console.log(`  overlaid     ${overlaid} generator-owned object(s) from the repo snapshot`
  + `${overlaid === 0 ? ' — export already matches the generator' : ''}`);
console.log(`  added to     "${policy.name}" → ${policy.children.length} rules`);
console.log('  validated    no dangling refs, no multi-parent private statements, no duplicate attribute names');
