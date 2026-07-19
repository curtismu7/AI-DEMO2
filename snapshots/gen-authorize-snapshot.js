#!/usr/bin/env node
/**
 * gen-authorize-snapshot.js — SoT-driven reconciler for the cloud PingOne
 * Authorize import file.
 *
 * PingOne Authorize has NO policy API for COMPARISON conditions, so the cloud
 * policy is updated by importing a snapshot. This script keeps that snapshot in
 * sync with scope-topology.json (the single source of truth all engines share)
 * so the cloud policy gates EVERY use-case/chip tool, not just create_transfer.
 *
 * It reconciles, by stable ID, the tool-name-driven parts of the snapshot:
 *   - RequiresHitlConsent  (cond 0010): ToolName IN {challengeType:'consent'} AND HitlApproved!=true  -> HITL
 *   - RequiresMcpStepUp    (cond 0013): ToolName IN {challengeType:'step_up'} AND NOT HasMFAAuthentication -> step-up
 *   - IsConsentTransaction (cond 0014): Amount > confirm($250) -> transaction-path consent
 * plus the rules that reference them and their membership in the two policies.
 * Everything else in the snapshot (attributes, deny rules, amount rules) is left
 * untouched. Re-running is idempotent.
 *
 * Usage:  node snapshots/gen-authorize-snapshot.js          (writes in place)
 *         node snapshots/gen-authorize-snapshot.js --check  (fail if out of date)
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SOT = path.join(REPO, 'scope-topology.json');
const SNAP = path.join(__dirname, 'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json');

const ATTR = {
  Amount: '12345678-0001-4321-abcd-000000000001',
  ToolName: '12345678-0008-4321-abcd-000000000008',
  HitlApproved: '12345678-0013-4321-abcd-000000000013',
  RarMaxAmount: '12345678-0020-4321-abcd-000000000020',     // new: RFC 9396 granted amount ceiling
};
const COND = {
  HasMFAAuthentication: '23456789-0003-4321-abcd-000000000003',
  RequiresHitlConsent: '23456789-0010-4321-abcd-000000000010',
  RequiresMcpStepUp: '23456789-0013-4321-abcd-000000000013',
  IsConsentTransaction: '23456789-0014-4321-abcd-000000000014',
  IsMcpFirstToolRequest: '23456789-0008-4321-abcd-000000000008',
  RarAmountExceeded: '23456789-0020-4321-abcd-000000000020', // new: Amount > RarMaxAmount
};
const STMT = {
  stepUp: '34567890-0003-4321-abcd-000000000003',           // step-up-required (reused)
  hitl: '34567890-0009-4321-abcd-000000000009',             // HITL (reused)
  txConsent: '34567890-0011-4321-abcd-000000000011',        // new transaction consent
  rarAmountExceeded: '34567890-0020-4321-abcd-000000000020', // new: rar_amount_exceeded (DENY)
};
const RULE = {
  mcpHitl: '45678901-0008-4321-abcd-000000000008',          // existing (generalized)
  mcpStepUp: '45678901-0010-4321-abcd-000000000010',        // new
  txConsent: '45678901-0011-4321-abcd-000000000011',        // new
  rarAmountExceeded: '45678901-0020-4321-abcd-000000000020', // new: RAR amount-cap DENY
  mcpPermitValid: '45678901-0007-4321-abcd-000000000007',
  txPermitStandard: '45678901-0003-4321-abcd-000000000003',
};
const POLICY = { transaction: '56789012-0001-4321-abcd-000000000001', mcp: '56789012-0002-4321-abcd-000000000002' };
const CONFIRM_USD = '250';

function toolOr(tools) {
  return { or: { conditions: tools.map((t) => ({
    comparison: { left: { attribute: { id: ATTR.ToolName } }, op: 'Equals', right: { constant: { value: t } } },
  })) } };
}

function loadSot() {
  const sot = JSON.parse(fs.readFileSync(SOT, 'utf8'));
  const tools = sot.tools || {};
  const consent = [];
  const stepUp = [];
  for (const [name, meta] of Object.entries(tools)) {
    if (!meta || typeof meta !== 'object') continue;
    if (meta.challengeType === 'consent') consent.push(name);
    else if (meta.challengeType === 'step_up') stepUp.push(name);
  }
  consent.sort(); stepUp.sort();
  return { consent, stepUp };
}

function reconcile(snap, { consent, stepUp }) {
  const byId = new Map(snap.map((o) => [o.id, o]));
  const sepIdx = snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator');

  // 1) Generalize RequiresHitlConsent -> consent tool list.
  const hitlCond = byId.get(COND.RequiresHitlConsent);
  hitlCond.name = 'RequiresHitlConsent';
  hitlCond.fullName = 'RequiresHitlConsent';
  hitlCond.description =
    `ToolName is one of the consent-gated tools (${consent.join(', ')}) AND HitlApproved is not true. ` +
    `Fires the HITL approval obligation. On a verified retry (HitlApproved=true) this is false and the call proceeds. ` +
    `Generated from scope-topology.json (challengeType=consent) — do not hand-edit.`;
  hitlCond.condition = { and: { conditions: [
    toolOr(consent),
    { comparison: { left: { attribute: { id: ATTR.HitlApproved } }, op: 'NotEquals', right: { constant: { value: true } } } },
  ] } };

  // 2) Ensure RequiresMcpStepUp condition (step_up tool list AND no MFA yet).
  const stepUpCond = {
    objectType: 'ConditionDefinition', id: COND.RequiresMcpStepUp,
    version: 'bbbbbbbb-0013-4321-abcd-000000000013', type: 'CONDITION',
    name: 'RequiresMcpStepUp', fullName: 'RequiresMcpStepUp',
    description: `ToolName is one of the step-up-gated tools (${stepUp.join(', ')}) AND the user has NOT completed MFA. ` +
      `Fires the step-up obligation on the MCP path. Generated from scope-topology.json (challengeType=step_up) — do not hand-edit.`,
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      toolOr(stepUp),
      { not: { condition: { reference: { id: COND.HasMFAAuthentication } } } },
    ] } },
  };

  // 3) Ensure IsConsentTransaction condition (transaction-path amount consent).
  const txConsentCond = {
    objectType: 'ConditionDefinition', id: COND.IsConsentTransaction,
    version: 'bbbbbbbb-0014-4321-abcd-000000000014', type: 'CONDITION',
    name: 'IsConsentTransaction', fullName: 'IsConsentTransaction',
    description: `Amount exceeds $${CONFIRM_USD} — the consent (HITL) threshold for transactions. ` +
      `Step-up ($500) and deny ($2,000) take precedence in the BFF obligation classifier.`,
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { constant: { value: CONFIRM_USD } } } },
    ] } },
  };

  // Upsert the two new conditions just before the package separator.
  for (const cond of [stepUpCond, txConsentCond]) {
    const existing = snap.findIndex((o) => o.id === cond.id && o.objectType === 'ConditionDefinition');
    if (existing >= 0) snap[existing] = cond;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator'), 0, cond);
  }

  // 4) Generalize the MCP HITL rule wording (condition ref unchanged — 0010).
  const mcpHitlRule = byId.get(RULE.mcpHitl);
  mcpHitlRule.name = 'MCP Require HITL Consent for sensitive tools';
  mcpHitlRule.description =
    'PERMIT with HITL obligation when ToolName is a consent-gated tool and HitlApproved is not true ' +
    '(see RequiresHitlConsent, generated from scope-topology.json challengeType=consent). On a verified ' +
    'receipt retry the condition is false and the call proceeds via MCP Permit Valid. HitlApproved MUST NOT discharge step-up MFA.';

  // 5) Ensure MCP step-up rule.
  const mcpStepUpRule = {
    id: RULE.mcpStepUp, version: 'dddddddd-0010-4321-abcd-000000000010', type: 'Rule', targets: [],
    name: 'MCP Require Step-Up for sensitive tools',
    description: 'PERMIT with step-up obligation when ToolName is a step-up-gated tool and the user has not completed MFA ' +
      '(see RequiresMcpStepUp, generated from scope-topology.json challengeType=step_up). The BFF returns HTTP 428 (mcp_step_up_required).',
    shared: false, disabled: false, statements: [STMT.stepUp],
    effectSettings: { type: 'unconditionalPermit' },
    condition: { and: { conditions: [{ reference: { id: COND.RequiresMcpStepUp } }] } },
  };
  {
    const i = snap.findIndex((o) => o.id === RULE.mcpStepUp && o.type === 'Rule');
    if (i >= 0) snap[i] = mcpStepUpRule;
    else snap.splice(snap.findIndex((o) => o.id === RULE.mcpPermitValid && o.type === 'Rule'), 0, mcpStepUpRule);
  }

  // 6) Ensure transaction consent statement + rule.
  const txConsentStmt = {
    id: STMT.txConsent, version: 'cccccccc-0011-4321-abcd-000000000011', type: 'Statement',
    name: 'Transaction Consent Required', shared: false,
    description: "Returned when a transaction is at or above the $250 consent threshold and requires explicit human approval. " +
      "Code contains HITL_CONSENT so the BFF obligation classifier sets consentRequired (HTTP 428).",
    code: 'HITL_CONSENT', appliesTo: 'PERMIT', appliesIf: 'PATH_MATCHES',
    payload: `{"consentRequired": true, "message": "Transaction of $\{{${ATTR.Amount}}} requires explicit consent before proceeding.", "amount": "{{${ATTR.Amount}}}"}`,
    obligatory: false, attributes: [], services: [],
  };
  {
    const i = snap.findIndex((o) => o.id === STMT.txConsent && o.type === 'Statement');
    if (i >= 0) snap[i] = txConsentStmt;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator' && snap.indexOf(o) > sepIdx) >= 0
      ? snap.indexOf(byId.get(RULE.txPermitStandard))
      : snap.length, 0, txConsentStmt);
  }
  const txConsentRule = {
    id: RULE.txConsent, version: 'dddddddd-0011-4321-abcd-000000000011', type: 'Rule', targets: [],
    name: 'Require Consent for Mid-Value Transactions',
    description: 'PERMIT with consent obligation when Amount > $250. Step-up ($500 transfers/withdrawals) and Deny ($2,000) ' +
      'take precedence via DenyOverrides + the BFF obligation classifier (step-up dominates consent).',
    shared: false, disabled: false, statements: [STMT.txConsent],
    effectSettings: { type: 'unconditionalPermit' },
    condition: { and: { conditions: [{ reference: { id: COND.IsConsentTransaction } }] } },
  };
  {
    const i = snap.findIndex((o) => o.id === RULE.txConsent && o.type === 'Rule');
    if (i >= 0) snap[i] = txConsentRule;
    else snap.splice(snap.findIndex((o) => o.id === RULE.txPermitStandard && o.type === 'Rule'), 0, txConsentRule);
  }

  // 7) Ensure rule membership in the two policies (before the catch-all permit).
  const addChild = (policyId, ruleId, beforeRuleId) => {
    const pol = byId.get(policyId);
    if (pol.children.some((c) => c.id === ruleId)) return;
    const idx = pol.children.findIndex((c) => c.id === beforeRuleId);
    pol.children.splice(idx >= 0 ? idx : pol.children.length, 0, { id: ruleId, type: 'Rule' });
  };
  addChild(POLICY.mcp, RULE.mcpStepUp, RULE.mcpPermitValid);
  addChild(POLICY.transaction, RULE.txConsent, RULE.txPermitStandard);

  // 8) RAR (RFC 9396) amount-cap enforcement — mirrors the simulated engine's
  // NNP-1 rar_amount_exceeded so PingOne Authorize (not just the gateway) denies
  // a tool call whose Amount exceeds the granted RarMaxAmount. The BFF/gateway
  // send RarMaxAmount (the azd.authorization_details[0].amount ceiling) on
  // delegated calls that carry a RAR grant; it is absent otherwise, so the guard
  // below keeps every non-RAR call unaffected.
  const upsert = (obj, sameType) => {
    const i = snap.findIndex((o) => o.id === obj.id && (sameType ? o.objectType === obj.objectType : o.type === obj.type));
    if (i >= 0) snap[i] = obj;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator'), 0, obj);
  };

  // 8a) RarMaxAmount request attribute (NUMBER) — same resolver shape as Amount.
  upsert({
    objectType: 'AttributeDefinition', id: ATTR.RarMaxAmount,
    version: 'aaaaaaaa-0021-4321-abcd-000000000021', type: 'ATTRIBUTE',
    name: 'RarMaxAmount', fullName: 'RarMaxAmount',
    description: 'RFC 9396 RAR granted amount ceiling (azd.authorization_details[0].amount). ' +
      'Sent by the Super Banking BFF/gateway on delegated tool calls that carry a RAR grant; absent otherwise. ' +
      'defaultValue 0 (like HitlApproved=false) so an ABSENT grant resolves to 0 instead of leaving the ' +
      'comparison unresolved — an unresolved NUMBER makes the rule (and the whole MCP decision) INDETERMINATE.',
    parentId: null, numberOfChildren: null, valueProcessor: null,
    valueType: 'NUMBER',
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    // MUST be 0, not null: absent RarMaxAmount → 0 → the "RarMaxAmount > 0" guard
    // is false → the deny rule does not fire → ordinary (non-RAR) calls PERMIT.
    defaultValue: 0, repetitionSource: null, valueSchema: null,
  }, true);

  // 8b) RarAmountExceeded condition: a grant is present (RarMaxAmount > 0) AND the
  // requested Amount exceeds it. When no grant is attached (RarMaxAmount absent/0)
  // the guard is false, so ordinary calls never trip this.
  upsert({
    objectType: 'ConditionDefinition', id: COND.RarAmountExceeded,
    version: 'bbbbbbbb-0021-4321-abcd-000000000021', type: 'CONDITION',
    name: 'RarAmountExceeded', fullName: 'RarAmountExceeded',
    description: 'RarMaxAmount > 0 (a RAR grant is present) AND Amount > RarMaxAmount. ' +
      'Absent grant → false → non-RAR calls unaffected. Mirrors simulatedAuthorizeService NNP-1.',
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.RarMaxAmount } }, op: 'GreaterThan', right: { constant: { value: '0' } } } },
      { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { attribute: { id: ATTR.RarMaxAmount } } } },
    ] } },
  }, true);

  // 8c) rar_amount_exceeded DENY statement (code matches the simulated deny_reason).
  upsert({
    id: STMT.rarAmountExceeded, version: 'cccccccc-0021-4321-abcd-000000000021', type: 'Statement',
    name: 'RAR Amount Exceeded', shared: false,
    description: 'Returned when the requested amount exceeds the RFC 9396 RAR granted ceiling. ' +
      'code rar_amount_exceeded surfaces as the deny_reason in the BFF/Token Chain.',
    code: 'rar_amount_exceeded', appliesTo: 'DENY', appliesIf: 'PATH_MATCHES',
    payload: `RAR amount enforcement: requested $\{{${ATTR.Amount}}} exceeds the granted ceiling of $\{{${ATTR.RarMaxAmount}}} ` +
      `(RFC 9396 authorization_details). The agent cannot exceed the attested limit even with a valid token.`,
    obligatory: false, attributes: [], services: [],
  });

  // 8d) RAR deny rule — conditionalDenyElsePermit, same shape as "Deny Large
  // Transactions". DenyOverrides makes this win when it fires.
  upsert({
    id: RULE.rarAmountExceeded, version: 'dddddddd-0021-4321-abcd-000000000021', type: 'Rule', targets: [],
    name: 'Deny RAR Amount Overage',
    description: 'DENY when Amount exceeds the RFC 9396 RAR granted ceiling (RarMaxAmount). ' +
      'No RAR grant → condition false → permit contribution only. PingOne-side twin of the gateway requireRarIntent check.',
    shared: false, disabled: false, statements: [STMT.rarAmountExceeded],
    effectSettings: { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [{ reference: { id: COND.RarAmountExceeded } }] } } },
    condition: { and: { conditions: [{ reference: { id: COND.RarAmountExceeded } }] } },
  });

  // 8e) Membership: MCP first-tool policy (before the catch-all permit). DenyOverrides
  // means placement is not strictly required, but keep it ahead of mcpPermitValid for clarity.
  addChild(POLICY.mcp, RULE.rarAmountExceeded, RULE.mcpPermitValid);

  return snap;
}

function main() {
  const check = process.argv.includes('--check');
  const original = fs.readFileSync(SNAP, 'utf8');
  const snap = JSON.parse(original);
  reconcile(snap, loadSot());
  // One compact JSON object per line (matches the original snapshot format).
  const out = '[\n  ' + snap.map((o) => JSON.stringify(o)).join(',\n  ') + '\n]\n';
  if (check) {
    if (out !== original) { console.error('Snapshot out of date — run: node snapshots/gen-authorize-snapshot.js'); process.exit(1); }
    console.log('Snapshot up to date.'); return;
  }
  fs.writeFileSync(SNAP, out);
  const sot = loadSot();
  console.log(`Reconciled snapshot: ${sot.consent.length} consent tools, ${sot.stepUp.length} step-up tools.`);
  console.log('consent:', sot.consent.join(', '));
  console.log('step_up:', sot.stepUp.join(', '));
}

main();
