#!/usr/bin/env node
'use strict';

/**
 * Generates snapshots/mcp-amount-bands.import.snapshot.json — a PingOne
 * Authorize snapshot that adds AMOUNT BANDS to the MCP decision endpoint.
 *
 * Why this exists: PingGateway now owns HITL enforcement, and it makes exactly
 * ONE PDP call — to the MCP decision endpoint. The amount bands the demo relies
 * on ($300 consent / $600 step-up / $2500 deny) live in the *Transaction*
 * decision endpoint, which the gateway never calls. The MCP policy's own
 * consent rule is keyed on "sensitive tools", so without this every
 * create_transfer would prompt for consent regardless of amount — a $5 transfer
 * included.
 *
 * Thresholds are 250 / 500 / 2000 to match the constants already present in the
 * environment's policy snapshot, NOT the 300/600/2500 the deleted BFF ladder
 * used. The demo amounts still land in the intended bands:
 *   $300  > 250  → consent      $600 > 500 → step-up      $2500 > 2000 → deny
 *
 * Statement codes are chosen so BOTH readers classify them without new mapping
 * code: demo_api_server/services/authorizeObligations.js strips separators and
 * matches HITLCONSENT → consent, STEPUP → step-up, and PingGateway's
 * p1az-decision.groovy uses the same normalization.
 *
 * Regenerate:  node snapshots/gen-mcp-amount-bands-import.js
 * Fresh UUIDs are minted on every run — see "Do not re-run casually" below.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ATTR = {
  Amount: randomUUID(),
  DecisionContext: randomUUID(),
  Acr: randomUUID(),
  HitlApproved: randomUUID(),
  UseCaseId: randomUUID(),
};
const COND = {
  IsMcpToolCall: randomUUID(),
  ExceedsDenyLimit: randomUUID(),
  ExceedsStepUpLimit: randomUUID(),
  RequiresConsent: randomUUID(),
  RequiresDecoupledApproval: randomUUID(),
};
const STMT = {
  Deny: randomUUID(),
  StepUp: randomUUID(),
  Consent: randomUUID(),
  Approved: randomUUID(),
};
const RULE = {
  Deny: randomUUID(),
  StepUp: randomUUID(),
  Decoupled: randomUUID(),
  Consent: randomUUID(),
  CatchAll: randomUUID(),
};
const POLICY = randomUUID();
const POLICY_SET = randomUUID();

const attribute = (id, name, valueType, defaultValue, description) => ({
  objectType: 'AttributeDefinition',
  id,
  version: randomUUID(),
  type: 'ATTRIBUTE',
  name,
  fullName: name,
  description,
  parentId: null,
  numberOfChildren: null,
  valueProcessor: null,
  valueType,
  resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
  defaultValue,
  repetitionSource: null,
  valueSchema: null,
});

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
  comparison: {
    left: { attribute: { id: attrId } },
    op,
    right: { constant: { value } },
  },
});
const ref = (id) => ({ reference: { id } });

const statement = (id, name, code, appliesTo, payload, description) => ({
  id,
  version: randomUUID(),
  type: 'Statement',
  name,
  shared: false,
  description,
  code,
  appliesTo,
  appliesIf: 'PATH_MATCHES',
  payload,
  obligatory: false,
  attributes: [],
  services: [],
});

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

  // ── Attributes ────────────────────────────────────────────────────────────
  attribute(ATTR.Amount, 'McpAmount', 'NUMBER', 0,
    'Transaction amount on an MCP tool call. PingGateway sends it as both Amount and '
    + 'TransactionAmount (p1az-decision.groovy); default 0 keeps the bands inert for '
    + 'non-transactional tools instead of resolving INDETERMINATE.'),
  attribute(ATTR.DecisionContext, 'McpDecisionContext', 'STRING', '',
    'Which decision context the caller is in — McpToolCall for a tools/call. Default \'\' '
    + 'so these rules cannot fire on a request that did not declare one.'),
  attribute(ATTR.Acr, 'McpAcr', 'STRING', 'none',
    'Authentication context class of the caller. Default \'none\' — an omitted ACR is '
    + 'treated as NO strong authentication, so step-up fails closed.'),
  attribute(ATTR.HitlApproved, 'McpHitlApproved', 'STRING', 'false',
    'Set to \'true\' by PingGateway only after it has verified an approved, unexpired HITL '
    + 'receipt bound to this user/agent/tool/amount. Default \'false\' — an omitted value '
    + 'is never treated as consent.'),
  attribute(ATTR.UseCaseId, 'McpUseCaseId', 'STRING', '',
    'Business context the call was initiated under, forwarded by PingGateway from the BFF\'s '
    + 'X-Use-Case-Id header. Lets policy gate on INTENT rather than amount — the CIBA demo is '
    + 'amount-independent by design. Only ever used to REQUIRE a gate, so a missing or forged '
    + 'value cannot weaken a decision.'),

  // ── Conditions ────────────────────────────────────────────────────────────
  condition(COND.IsMcpToolCall, 'IsMcpToolCall',
    'The request is an MCP tools/call. Every band below references this so these rules '
    + 'stay inert in the Transaction and tools/list contexts.',
    cmp(ATTR.DecisionContext, 'Equals', 'McpToolCall')),

  condition(COND.ExceedsDenyLimit, 'McpExceedsDenyLimit',
    'MCP tool call whose amount is over the hard ceiling (2000). Matches the deny constant '
    + 'already present in this environment; the demo\'s $2500 case lands here.',
    { and: { conditions: [ref(COND.IsMcpToolCall), cmp(ATTR.Amount, 'GreaterThan', '2000')] } }),

  condition(COND.ExceedsStepUpLimit, 'McpExceedsStepUpLimit',
    'MCP tool call over 500 where the caller has not completed multi-factor auth. The demo\'s '
    + '$600 case lands here. A caller returning with Acr=Multi_Factor no longer matches, which '
    + 'is how a completed step-up discharges the gate.',
    { and: { conditions: [
      ref(COND.IsMcpToolCall),
      cmp(ATTR.Amount, 'GreaterThan', '500'),
      cmp(ATTR.Acr, 'NotEquals', 'Multi_Factor'),
    ] } }),

  condition(COND.RequiresConsent, 'McpRequiresHitlConsent',
    'MCP tool call over 250 with no verified HITL receipt. The demo\'s $300 case lands here. '
    + 'A retry carrying HitlApproved=true (set by PingGateway only after verifying the receipt '
    + 'against the HITL service) no longer matches, which discharges the gate.',
    { and: { conditions: [
      ref(COND.IsMcpToolCall),
      cmp(ATTR.Amount, 'GreaterThan', '250'),
      cmp(ATTR.HitlApproved, 'NotEquals', 'true'),
    ] } }),

  condition(COND.RequiresDecoupledApproval, 'McpRequiresDecoupledApproval',
    'MCP tool call initiated under the decoupled-approval (CIBA) use case. Deliberately has NO '
    + 'amount term: CIBA models "this sensitive, agent-initiated action needs out-of-band '
    + 'approval", not a dollar gate, which is why the demo amount is a small $150 that no '
    + 'amount band would catch.',
    { and: { conditions: [
      ref(COND.IsMcpToolCall),
      cmp(ATTR.UseCaseId, 'Equals', 'UC22'),
      cmp(ATTR.Acr, 'NotEquals', 'Multi_Factor'),
    ] } }),

  // ── Statements ────────────────────────────────────────────────────────────
  statement(STMT.Deny, 'MCP Deny — Amount Limit Exceeded', 'mcp_amount_limit_exceeded', 'DENY',
    `MCP tool call amount {{${ATTR.Amount}}} exceeds the maximum permitted amount.`,
    'Hard deny: the amount is over the ceiling. Not an obligation — no retry can satisfy it.'),

  statement(STMT.StepUp, 'MCP Permit — Step-Up Required', 'MCP_STEP_UP_REQUIRED', 'PERMIT',
    `MCP tool call amount {{${ATTR.Amount}}} requires step-up authentication before it can proceed.`,
    'Step-up obligation. The code normalizes to STEPUP, which authorizeObligations.js and '
    + 'PingGateway both classify as step-up (it outranks consent when both fire).'),

  statement(STMT.Consent, 'MCP Permit — HITL Consent Required', 'HITL_CONSENT_REQUIRED', 'PERMIT',
    `MCP tool call amount {{${ATTR.Amount}}} requires human approval before it can proceed.`,
    'Consent obligation. The code normalizes to HITLCONSENT, which both readers classify as '
    + 'consent — PingGateway turns it into a 428 plus a HITL challenge.'),

  statement(STMT.Approved, 'MCP Permit — Amount Within Limits', 'mcp_amount_ok', 'PERMIT',
    'MCP tool call amount is within policy limits.',
    'Catch-all approval so a call matching no band still resolves to a decision.'),

  // ── Rules ─────────────────────────────────────────────────────────────────
  rule(RULE.Deny, 'MCP Deny Over Limit',
    'DENY when an MCP tool call exceeds the hard ceiling. DenyOverrides means this wins over '
    + 'the obligation rules below when several bands match at once.',
    [STMT.Deny],
    { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [ref(COND.ExceedsDenyLimit)] } } },
    { and: { conditions: [ref(COND.ExceedsDenyLimit)] } }),

  rule(RULE.StepUp, 'MCP Require Step-Up',
    'PERMIT with a step-up obligation when an MCP tool call is over the step-up threshold and '
    + 'MFA has not been completed.',
    [STMT.StepUp],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.ExceedsStepUpLimit)] } }),

  rule(RULE.Decoupled, 'MCP Require Decoupled Approval for the CIBA Use Case',
    'PERMIT with a step-up obligation when the call runs under the decoupled-approval use case '
    + 'and MFA has not been completed. Amount-independent on purpose. The gateway emits the same '
    + '428 as any other step-up; the BFF resolves step_up_method=ciba from the use-case catalog '
    + 'on relay, so the agent drives the out-of-band flow rather than a device-list prompt.',
    [STMT.StepUp],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.RequiresDecoupledApproval)] } }),

  rule(RULE.Consent, 'MCP Require HITL Consent for Mid-Value Calls',
    'PERMIT with a consent obligation when an MCP tool call is over the consent threshold and '
    + 'carries no verified HITL receipt. An amount over the step-up threshold matches this rule '
    + 'too; the readers resolve that by precedence (step-up outranks consent), so no extra '
    + 'condition is needed here to exclude the higher band.',
    [STMT.Consent],
    { type: 'unconditionalPermit' },
    { and: { conditions: [ref(COND.RequiresConsent)] } }),

  rule(RULE.CatchAll, 'MCP Permit Within Limits',
    'PERMIT everything not caught above. Every policy needs exactly one catch-all with '
    + 'condition {empty:{}}, or a call matching no rule resolves INDETERMINATE — which both '
    + 'gateways read as "a human must approve" and would turn into a spurious 428.',
    [STMT.Approved],
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
      'Amount bands for the MCP decision endpoint, so a gateway that makes only the MCP call '
      + 'still gets an amount-aware gate. Rules: (1) DENY over 2000; (2) PERMIT+step-up over 500 '
      + 'without MFA; (3) PERMIT+step-up for the decoupled-approval use case, amount-independent; (4) PERMIT+HITL-consent over 250 without a verified receipt; (5) PERMIT '
      + 'otherwise. Every rule is gated on DecisionContext=McpToolCall.',
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
      'Root policy set for the MCP amount bands. DenyOverrides with evaluateAll=true: every '
      + 'child policy is evaluated and any DENY wins, so this composes with the existing MCP '
      + 'audience/actor-chain rules rather than replacing them.',
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
