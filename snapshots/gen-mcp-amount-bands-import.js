#!/usr/bin/env node
'use strict';

/**
 * Generates snapshots/mcp-amount-bands.import.snapshot.json — a PingOne
 * Authorize snapshot that binds the environment's EXISTING amount conditions to
 * rules in the MCP decision context.
 *
 * Why this exists: PingGateway owns HITL enforcement now, and it makes exactly
 * ONE PDP call — to the MCP decision endpoint. The amount bands are defined in
 * the environment already (IsConsentTransaction > 250, IsHighValueTransaction >
 * 500, IsLargeTransaction > 2000) but they are wired to the *Transaction*
 * context, which the gateway never calls. The MCP context's own consent rule is
 * keyed on sensitive TOOL NAMES, so without this every create_transfer would
 * prompt for consent regardless of amount — a $5 transfer included.
 *
 * REUSE, DO NOT REDEFINE. Every id below that already exists in the environment
 * is referenced, never re-created:
 *
 *   - Attributes resolve BY NAME against the decision request's `parameters`.
 *     Creating a second attribute named e.g. `McpAmount` would never match the
 *     `Amount` key the gateway sends: the condition would read its default, no
 *     rule would fire, and the import would appear to succeed while changing
 *     nothing. That is the failure mode this file is written to avoid.
 *   - Reusing the STATEMENT ids keeps the wire codes (`step-up-required`,
 *     `HITL_CONSENT`) exactly what all three readers already classify —
 *     authorizeObligations.js, authorizeObligations.ts, p1az-decision.groovy.
 *
 * Only genuinely new objects are created: the UseCaseId attribute (the
 * environment has none), the MCP-context conditions, and the rules themselves.
 *
 * Base ids come from snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json,
 * the repo's tracked reconcile base. VERIFY against a fresh console export before
 * importing — the actor-chain list is known to have drifted from this file, so
 * other ids could too.
 *
 * Regenerate:  node snapshots/gen-mcp-amount-bands-import.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// ── Existing objects — referenced by id, never redefined ─────────────────────
const EXISTING = {
  attr: {
    Amount: '12345678-0001-4321-abcd-000000000001',
    Acr: '12345678-0004-4321-abcd-000000000004',
    DecisionContext: '12345678-0007-4321-abcd-000000000007',
    HitlApproved: '12345678-0013-4321-abcd-000000000013', // BOOLEAN
  },
  cond: {
    IsLargeTransaction: '23456789-0001-4321-abcd-000000000001',     // Amount > 2000
    IsHighValueTransaction: '23456789-0004-4321-abcd-000000000004', // Amount > 500
    IsMcpFirstToolRequest: '23456789-0008-4321-abcd-000000000008',  // DecisionContext in MCP contexts
    IsConsentTransaction: '23456789-0014-4321-abcd-000000000014',   // Amount > 250
  },
  stmt: {
    Deny: '34567890-0013-4321-abcd-000000000013',    // mcp-tier-amount-exceeded (DENY)
    StepUp: '34567890-0003-4321-abcd-000000000003',  // step-up-required (PERMIT)
    Consent: '34567890-0011-4321-abcd-000000000011', // HITL_CONSENT (PERMIT)
  },
};

// ── New objects ──────────────────────────────────────────────────────────────
const ATTR_USE_CASE = randomUUID();
const COND = {
  McpAmountDeny: randomUUID(),
  McpAmountStepUp: randomUUID(),
  McpAmountConsent: randomUUID(),
  McpDecoupledApproval: randomUUID(),
};
const STMT_APPROVED = randomUUID();
const RULE = {
  Deny: randomUUID(),
  StepUp: randomUUID(),
  Decoupled: randomUUID(),
  Consent: randomUUID(),
  CatchAll: randomUUID(),
};
const POLICY = randomUUID();
const POLICY_SET = randomUUID();

const condition = (id, name, description, cond) => ({
  objectType: 'ConditionDefinition',
  id,
  version: randomUUID(),
  type: 'CONDITION',
  name,
  fullName: name,
  description,
  parentId: null,
  numberOfChildren: null,
  condition: cond,
});

const cmp = (attrId, op, value) => ({
  comparison: { left: { attribute: { id: attrId } }, op, right: { constant: { value } } },
});
const ref = (id) => ({ reference: { id } });
const notMfa = () => cmp(EXISTING.attr.Acr, 'NotEquals', 'Multi_Factor');

const rule = (id, name, description, statements, effectSettings, cond) => ({
  id,
  version: randomUUID(),
  type: 'Rule',
  targets: [],
  name,
  description,
  shared: false,
  disabled: false,
  statements,
  effectSettings,
  condition: cond,
});

const entries = [
  { '@class': 'DataStreamHeader', kind: 'SnapshotHeader', version: 2 },
  {
    type: 'SnapshotPackageFile$PackageHeader',
    snapshotId: randomUUID(),
    snapshotFileVersion: 2,
    applicationVersion: 'P1AZ-1.0.0.0',
  },

  // ── One new attribute: the environment has no UseCaseId ───────────────────
  // The NAME must be exactly what PingGateway sends as a parameter key
  // (p1az-decision.groovy: parameters.UseCaseId), or it will never resolve.
  {
    objectType: 'AttributeDefinition',
    id: ATTR_USE_CASE,
    version: randomUUID(),
    type: 'ATTRIBUTE',
    name: 'UseCaseId',
    fullName: 'UseCaseId',
    description:
      'Business context the call was initiated under, forwarded by PingGateway from the BFF\'s '
      + 'X-Use-Case-Id header. Lets policy gate on INTENT rather than amount — the CIBA demo is '
      + 'amount-independent by design ($150), so no amount band would catch it. Used only to '
      + 'REQUIRE a gate, never to waive one: a missing or forged value cannot weaken a decision. '
      + 'Default \'none\' so the rule stays inert when the header is absent.',
    parentId: null,
    numberOfChildren: null,
    valueProcessor: null,
    valueType: 'STRING',
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    defaultValue: 'none',
    repetitionSource: null,
    valueSchema: null,
  },

  // ── New conditions: existing amount bands, scoped to the MCP context ───────
  condition(COND.McpAmountDeny, 'McpAmountExceedsDenyLimit',
    'An MCP tool call that trips the environment\'s existing IsLargeTransaction band (> 2000). '
    + 'Reuses that condition rather than restating the threshold, so the deny ceiling stays in '
    + 'one place.',
    { and: { conditions: [ref(EXISTING.cond.IsMcpFirstToolRequest), ref(EXISTING.cond.IsLargeTransaction)] } }),

  condition(COND.McpAmountStepUp, 'McpAmountRequiresStepUp',
    'An MCP tool call over the existing IsHighValueTransaction band (> 500) where the caller has '
    + 'not completed MFA. Returning with Acr=Multi_Factor stops matching, which is how a '
    + 'completed step-up discharges the gate.',
    { and: { conditions: [ref(EXISTING.cond.IsMcpFirstToolRequest), ref(EXISTING.cond.IsHighValueTransaction), notMfa()] } }),

  condition(COND.McpAmountConsent, 'McpAmountRequiresHitlConsent',
    'An MCP tool call over the existing IsConsentTransaction band (> 250) with no verified HITL '
    + 'receipt. A retry carrying HitlApproved=true — set by PingGateway only after verifying the '
    + 'receipt against the HITL service — stops matching, which discharges the gate. Compared '
    + 'against the boolean constant true, matching how RequiresHitlConsent already reads it.',
    { and: { conditions: [
      ref(EXISTING.cond.IsMcpFirstToolRequest),
      ref(EXISTING.cond.IsConsentTransaction),
      cmp(EXISTING.attr.HitlApproved, 'NotEquals', true),
    ] } }),

  condition(COND.McpDecoupledApproval, 'McpRequiresDecoupledApproval',
    'An MCP tool call initiated under the decoupled-approval (CIBA) use case. Deliberately has NO '
    + 'amount term: CIBA models "this sensitive, agent-initiated action needs out-of-band '
    + 'approval", not a dollar gate, which is why the demo amount is a small $150.',
    { and: { conditions: [
      ref(EXISTING.cond.IsMcpFirstToolRequest),
      cmp(ATTR_USE_CASE, 'Equals', 'UC22'),
      notMfa(),
    ] } }),

  // ── One new statement: the catch-all approval ─────────────────────────────
  {
    id: STMT_APPROVED,
    version: randomUUID(),
    type: 'Statement',
    name: 'MCP Permit — Amount Within Limits',
    shared: false,
    description: 'Catch-all approval so a call matching no band still resolves to a decision.',
    code: 'mcp_amount_ok',
    appliesTo: 'PERMIT',
    appliesIf: 'PATH_MATCHES',
    payload: 'MCP tool call amount is within policy limits.',
    obligatory: false,
    attributes: [],
    services: [],
  },

  // ── Rules ─────────────────────────────────────────────────────────────────
  rule(RULE.Deny, 'MCP Deny Over Amount Limit',
    'DENY an MCP tool call over the deny ceiling. DenyOverrides means this wins over the '
    + 'obligation rules when several bands match at once. Reuses the existing '
    + 'mcp-tier-amount-exceeded statement.',
    [EXISTING.stmt.Deny],
    { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [ref(COND.McpAmountDeny)] } } },
    { and: { conditions: [ref(COND.McpAmountDeny)] } }),

  rule(RULE.StepUp, 'MCP Require Step-Up Over Amount Threshold',
    'PERMIT with the existing step-up-required statement when an MCP tool call is over the '
    + 'step-up threshold and MFA has not been completed.',
    [EXISTING.stmt.StepUp],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.McpAmountStepUp)] } }),

  rule(RULE.Decoupled, 'MCP Require Decoupled Approval for the CIBA Use Case',
    'PERMIT with the step-up statement when the call runs under the decoupled-approval use case, '
    + 'regardless of amount. The gateway emits the same 428 as any other step-up; the BFF '
    + 'resolves step_up_method=ciba from the use-case catalog on relay, so the agent drives the '
    + 'out-of-band flow rather than a device prompt.',
    [EXISTING.stmt.StepUp],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.McpDecoupledApproval)] } }),

  rule(RULE.Consent, 'MCP Require HITL Consent Over Amount Threshold',
    'PERMIT with the existing HITL_CONSENT statement when an MCP tool call is over the consent '
    + 'threshold and carries no verified receipt. An amount over the step-up threshold matches '
    + 'this rule too; the readers resolve that by precedence (step-up outranks consent), so no '
    + 'extra term is needed here to exclude the higher band.',
    [EXISTING.stmt.Consent],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.McpAmountConsent)] } }),

  rule(RULE.CatchAll, 'MCP Permit Within Amount Limits',
    'PERMIT everything this policy does not gate. Every policy needs exactly one catch-all with '
    + 'condition {empty:{}} — without it a call matching no rule resolves INDETERMINATE, which '
    + 'the gateways read as "a human must approve" and would turn into a spurious 428.',
    [STMT_APPROVED],
    { type: 'unconditionalPermit' },
    { empty: {} }),

  { type: 'SnapshotPackageFile$PackageSeparator' },

  {
    id: POLICY,
    version: randomUUID(),
    type: 'Policy',
    targets: [],
    combiningAlgorithm: { algorithm: 'DenyOverrides' },
    name: 'MCP Tool Call Amount Bands',
    description:
      'Binds the environment\'s existing amount bands to the MCP decision context, so a gateway '
      + 'that makes only the MCP call still gets an amount-aware gate. Rules: (1) DENY over the '
      + 'deny ceiling; (2) PERMIT+step-up over the step-up threshold without MFA; (3) PERMIT+step-up '
      + 'for the decoupled-approval use case, amount-independent; (4) PERMIT+HITL consent over the '
      + 'consent threshold without a verified receipt; (5) PERMIT otherwise. Every rule is gated on '
      + 'IsMcpFirstToolRequest so none of it fires in the Transaction context.',
    shared: false,
    disabled: false,
    children: [
      { id: RULE.Deny, type: 'Rule' },
      { id: RULE.StepUp, type: 'Rule' },
      { id: RULE.Decoupled, type: 'Rule' },
      { id: RULE.Consent, type: 'Rule' },
      { id: RULE.CatchAll, type: 'Rule' },
    ],
    repetitionSettings: null,
    statements: [],
    condition: { empty: {} },
  },

  {
    id: POLICY_SET,
    version: randomUUID(),
    type: 'PolicySet',
    targets: [],
    combiningAlgorithm: { algorithm: 'DenyOverrides', evaluateAll: true },
    name: 'MCP Amount Bands',
    description:
      'Container for the MCP amount bands. IMPORTANT: a decision endpoint evaluates the policy '
      + 'tree it is bound to — after importing, move "MCP Tool Call Amount Bands" under the policy '
      + 'set the MCP decision endpoint already uses, or this imports cleanly and is never '
      + 'evaluated.',
    shared: false,
    disabled: false,
    children: [{ id: POLICY, type: 'Policy' }],
    statements: [],
    managedEntity: { owner: { service: { name: 'Editor Service' } } },
    condition: { empty: {} },
  },

  { type: 'SnapshotPackageFile$PackageSeparator' },
  { type: 'SnapshotPackageFile$EndOfPackage' },
  { '@class': 'DataStreamFooter', digest: 'mcp-amount-bands' },
];

const out = `[\n  ${entries.map((e) => JSON.stringify(e)).join(',\n  ')}\n]\n`;
const dest = path.join(__dirname, 'mcp-amount-bands.import.snapshot.json');
fs.writeFileSync(dest, out);
console.log(`Wrote ${dest} (${entries.length} entries)`);
