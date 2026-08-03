#!/usr/bin/env node
'use strict';
/**
 * verifyAuthorizeCloudParity.js — does the LIVE PingOne Authorize policy enforce
 * the rules this repo authored for it?
 *
 * THE SPLIT BRAIN, AND WHAT IT ACTUALLY IS
 *
 * The Node Agent Gateway sends its decisions to authz-server, whose /health
 * reports policySource "p1az-mock". That reads like "a fake stands in for
 * PingOne" — and it is the wrong reading, which is why this script exists.
 *
 * authz-server is a faithful local implementation of an AUTHORED cloud policy.
 * `snapshots/gen-authorize-snapshot.js` generates
 * `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json` from
 * the same source of truth, and the mock deliberately emits the SAME
 * `statements[].code` values the snapshot defines (see DENY_CODE_BY_REASON_PREFIX
 * in demo_authz_server/routes/decision.js).
 *
 * STATUS — 2026-08-03: the snapshot IS imported and all 7 authored rules below
 * are enforced live. This script exits 0. It stays as the standing gate: run it
 * after any snapshot regeneration or import to prove the cloud still matches.
 *
 * History, because the shape of the last failure is worth keeping. Probed
 * 2026-07-27, before the import, the live endpoint ran an OLDER PARTIAL policy:
 *
 *     amount ceiling ($5000 transfer)      -> DENY    (enforced)
 *     A2A delegation (act depth 1)         -> PERMIT  (NOT enforced)
 *     insufficient scope / unknown tool    -> PERMIT  (gateway's job, not policy)
 *
 * ⚠️ AN UNDER-SPECIFIED PROBE LOOKS EXACTLY LIKE A MISSING RULE. The UC21
 * restricted-tool row reported MISSING across three separate imports. The rule
 * was live and correct the whole time; the probe's PERMIT control omitted
 * `Amount`, its allowed branch fell through to a cap comparison against a
 * missing numeric, and P1AZ returned INDETERMINATE with NO statements. The
 * script counts anything that is not PERMIT as "not discriminating", so a
 * correct policy read as a broken one and sent someone into the console to
 * author a condition that already existed. Before concluding a rule is not
 * imported, send its permit case by hand and look at the raw body: an
 * INDETERMINATE with no statements is an ATTRIBUTE problem in the probe, not a
 * policy gap. A DENY carrying the wrong code is the real "missing rule" tell.
 *
 * WHAT THIS SCRIPT DOES
 *
 * Probes the live cloud endpoint with the same parameter names the gateway
 * sends, one authored deny-rule at a time, and reports which are live. Run it
 * after importing the snapshot: when every rule is enforced, the Node gateway
 * can be pointed at the cloud and the split brain closes with no rules lost.
 *
 * READ-ONLY. It evaluates decisions; it never writes policy, grants, or config.
 * (The worker cannot write policy anyway — authorizationPolicies returns 403.)
 *
 * Usage:  node demo_api_server/scripts/verifyAuthorizeCloudParity.js
 * Exit 0 only when every authored rule below is enforced live.
 */

const { decide, params, workerToken } = require('./verifyA2aDelegationPolicy');

/**
 * One authored deny-rule per row. `deny` must describe a request the AUTHORED
 * policy denies — if the live endpoint PERMITs it, that rule is not imported.
 *
 * Faithfulness matters more than coverage here: a probe that misnames a
 * parameter produces a false "not enforced" and would send someone chasing a
 * policy bug that does not exist. Every key below is taken from the destructure
 * in demo_authz_server/routes/decision.js, and each row names the mock rule it
 * mirrors so the two can be compared by hand.
 */
const RULES = [
  {
    code: 'mcp-invalid-a2a-generalist',
    label: 'A2A — act chain depth >= 2',
    mockRule: 'Rule 1c (depth half)',
    deny: { tool: 'sensitive_patient_records', vertical: 'healthcare', depth: 1 },
  },
  {
    // The imported statement is about the NESTED GENERALIST, not depth — the mock
    // Rule 1c does both and the cloud policy only got the second half. Probing
    // depth alone reported the whole rule missing and hid that half of it landed.
    code: 'mcp-invalid-actor',
    label: 'A2A — nested generalist is the registered agent',
    mockRule: 'Rule 1c (generalist half)',
    deny: {
      tool: 'sensitive_patient_records', vertical: 'healthcare', depth: 2,
      extra: { NestedActClientId: '00000000-0000-4000-8000-0000000000ff', MayActSub: '00000000-0000-4000-8000-0000000000ff' },
    },
  },
  {
    code: 'transaction-denied',
    label: 'amount ceiling',
    mockRule: 'Rule 3b',
    // DecisionContext MUST be Transaction. The MCP contexts route to the MCP
    // Delegation policy, and the amount ceiling lives in the Transaction policy
    // — so probing this as McpToolCall returns PERMIT no matter what the rule
    // says, and this row reported a live rule as MISSING for exactly that
    // reason. Verified: Amount 5000 -> DENY, Amount 100 -> PERMIT.
    deny: {
      tool: 'create_transfer', vertical: 'banking', depth: 1,
      extra: { DecisionContext: 'Transaction', Amount: 5000, TransactionType: 'create_transfer', TokenScopes: 'transfer' },
    },
    permit: { DecisionContext: 'Transaction', Amount: 100, TransactionType: 'create_transfer', TokenScopes: 'transfer' },
  },
  {
    code: 'mcp-user-not-in-group',
    label: 'group membership (UC9)',
    mockRule: 'Rule 3.5b',
    // InRequiredGroup is the attribute the rule actually reads: a BFF-RESOLVED
    // boolean (the snapshot DSL has no array-contains operator), DEFAULTING TO
    // TRUE. Sending UserGroups/RequiredGroup and omitting it left the default
    // in place, so the condition could never be true and this row reported a
    // live rule as MISSING. Verified: false -> DENY, true -> PERMIT.
    deny: {
      tool: 'get_my_accounts', vertical: 'banking', depth: 1,
      extra: { RequiredGroup: 'Premium', UserGroups: '["Standard"]', InRequiredGroup: false },
    },
    permit: { RequiredGroup: 'Premium', UserGroups: '["Premium"]', InRequiredGroup: true },
  },
  {
    code: 'mcp-tier-tool-not-allowed',
    label: 'entitlement tier — restricted tool (UC21)',
    mockRule: 'Rule 3d(a)',
    // UserTier is the BFF-resolved scalar (tiers.groupToTier maps a group ARRAY
    // to a tier and the snapshot DSL has no array-contains, same wall as
    // InRequiredGroup above). It DEFAULTS TO 'none', so omitting it leaves every
    // tier rule dormant and this row would report a live rule as MISSING.
    //
    // The permit control is the whole point of the story: the SAME tool, denied
    // for Standard and allowed for PrivateBanking. Group membership expands
    // capability. PrivateBanking returns PERMIT with a step-up obligation, which
    // is still a PERMIT decision.
    //
    // Amount MUST be sent, on BOTH sides. Standard is denied by the tool
    // restriction before any amount is considered, so the deny case passes
    // without it — but PrivateBanking clears that restriction and falls through
    // to the tier AMOUNT CAP, and a cap comparison against a missing numeric
    // evaluates to INDETERMINATE with no statements at all. The probe read that
    // as "denies its allowed case too" and reported a live, correct rule as
    // MISSING for three imports running. Probed 2026-08-03: PrivateBanking with
    // no Amount -> INDETERMINATE; with Amount -> PERMIT; Standard with Amount ->
    // still DENY mcp-tier-tool-not-allowed. Tier stays the only discriminator.
    // 100 is well under every tier ceiling, so it tests the restriction, not the cap.
    deny: {
      tool: 'create_withdrawal', vertical: 'banking', depth: 1,
      extra: { UserTier: 'Standard', Amount: 100, TransactionType: 'create_withdrawal' },
    },
    permit: { UserTier: 'PrivateBanking' },
  },
  {
    code: 'mcp-tier-amount-exceeded',
    label: 'entitlement tier — amount ceiling (UC21)',
    mockRule: 'Rule 3d(b)',
    // $5,000 is over Standard's $2,000 ceiling and under PrivateBanking's
    // $50,000 one, so the SAME amount flips on tier alone. That is what makes
    // this a real test of ExceedsTierAmountCap's per-tier branches rather than a
    // restatement of the Transaction policy's flat "Deny Large Transactions".
    // Both ceilings are generated from the banking manifest tiers block by
    // snapshots/gen-authorize-snapshot.js — if you changed them there, this row
    // is what proves the import actually landed.
    deny: {
      tool: 'create_transfer', vertical: 'banking', depth: 1,
      extra: { UserTier: 'Standard', Amount: 5000, TransactionType: 'create_transfer' },
    },
    permit: { UserTier: 'PrivateBanking' },
  },
  {
    code: 'mcp-resource-owner-mismatch',
    label: 'resource ownership (UC10)',
    mockRule: 'Rule 3.5a',
    deny: {
      tool: 'get_my_accounts', vertical: 'banking', depth: 1,
      extra: { ResourceOwnerId: '00000000-0000-4000-8000-00000000dead' },
    },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[cloud-parity] does the LIVE PingOne Authorize policy enforce the authored rules?');
  console.log('[cloud-parity] source of truth: snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json\n');

  const token = await workerToken();

  // Control first. If a plainly-allowed call does not PERMIT, the endpoint is
  // not evaluating normally and every DENY below would be meaningless agreement
  // rather than enforcement.
  const control = await decide(token, params({ tool: 'get_my_accounts', depth: 1, vertical: 'banking' }));
  console.log(`  control   get_my_accounts -> ${control.decision || `HTTP ${control.status}`}`);
  if (control.decision !== 'PERMIT') {
    console.error('\n[cloud-parity] ABORT — the control probe did not PERMIT, so this endpoint is not');
    console.error('               evaluating normally. Nothing below would be trustworthy.');
    process.exit(1);
  }
  console.log('');

  const rows = [];
  for (const rule of RULES) {
    await sleep(1400);
    const p = { ...params({ tool: rule.deny.tool, depth: rule.deny.depth, vertical: rule.deny.vertical }), ...(rule.deny.extra || {}) };
    const r = await decide(token, p);
    // A DENY alone is not proof: the endpoint can deny for an unrelated reason
    // (an empty ActClientId denies as mcp-invalid-actor and would otherwise read
    // as "the depth rule works"). Require the statement code this rule owns.
    const codes = ((r.body && r.body.statements) || []).map((st) => st.code).filter(Boolean);
    const denied = r.decision === 'DENY' && codes.includes(rule.code);
    const mismatch = r.decision === 'DENY' && !denied;

    // Negative control. A rule that denies its bad case AND its good one is not
    // enforcing anything — it is broken in a way that reads as enforcement, and
    // is exactly what a one-sided probe cannot see.
    let discriminates = true;
    let permitDecision = null;
    if (denied && rule.permit) {
      await sleep(1400);
      const ok = await decide(token, { ...p, ...rule.permit });
      permitDecision = ok.decision;
      discriminates = ok.decision === 'PERMIT';
    }

    const enforced = denied && discriminates;
    rows.push({ ...rule, decision: r.decision, codes, enforced, mismatch, permitDecision });
    console.log(
      `  ${enforced ? 'live   ' : 'MISSING'} ${rule.label.padEnd(44)} ${String(r.decision).padEnd(7)}`
      + `[${codes.join('+') || '-'}]`
      + (mismatch ? '  <- DENY, but not this rule' : '')
      + (denied && !discriminates ? `  <- denies its ALLOWED case too (${permitDecision}) — not discriminating` : ''),
    );
  }

  const missing = rows.filter((r) => !r.enforced);
  console.log('');
  if (!missing.length) {
    console.log(`[cloud-parity] PASS — ${rows.length}/${rows.length} authored rules are live in the cloud policy.`);
    console.log('               The Node Agent Gateway can now be pointed at PingOne Authorize:');
    console.log('               set PINGAUTHORIZE_ENDPOINT to the cloud decision endpoint and leave');
    console.log('               PINGAUTHORIZE_MOCK_BASE as the failover target only.');
    process.exit(0);
  }

  console.log(`[cloud-parity] FAIL — ${missing.length} of ${rows.length} authored rules are NOT live:`);
  for (const m of missing) console.log(`      ${m.label}  (${m.code})`);
  console.log('');
  console.log('  These rules run in authz-server but the live decision endpoint permits what');
  console.log('  they deny, so authz-server is the ONLY place they run. Pointing the Agent');
  console.log('  Gateway at the cloud now would remove exactly these while making the demo');
  console.log('  look more legitimate.');
  console.log('');
  console.log('  CHECK THE PROBE BEFORE THE POLICY. A row marked "denies its ALLOWED case');
  console.log('  too (INDETERMINATE)" is almost always a MISSING ATTRIBUTE in this file, not');
  console.log('  an un-authored rule: the permit branch reached a comparison whose operand');
  console.log('  was never sent, and P1AZ returns INDETERMINATE with no statements. Re-send');
  console.log('  that permit case by hand and read the raw body first. Only a DENY that');
  console.log('  carries the wrong statement code means the rule is genuinely not live —');
  console.log('  and that one needs a condition authored in the console (Authorization');
  console.log('  Admin role; the demo worker is 403 on the policy APIs).');
  console.log('');
  console.log('  Note: act-chain DEPTH and the nested-generalist check are two halves of mock');
  console.log('  Rule 1c. The second half is live; the first is not. A specialist token still');
  console.log('  gets in on depth 1, which is the control UC2 exists to demonstrate.');
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => { console.error('[cloud-parity] failed:', err.message); process.exit(1); });
}

module.exports = { RULES };
