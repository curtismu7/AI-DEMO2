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
 * That snapshot has never been imported into the live environment. So the live
 * decision endpoint runs an OLDER, PARTIAL policy. Probed 2026-07-27:
 *
 *     amount ceiling ($5000 transfer)      -> DENY    (enforced)
 *     A2A delegation (act depth 1)         -> PERMIT  (NOT enforced)
 *     insufficient scope / unknown tool    -> PERMIT  (gateway's job, not policy)
 *
 * The gap is therefore NOT "someone is lying about the engine". It is one
 * pending operation: import the reconciled snapshot. Until then the mock is the
 * only place several authored rules actually run, and pointing the gateway at
 * the cloud would delete them while making the demo look MORE legitimate — the
 * worst possible trade.
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
    deny: {
      tool: 'create_transfer', vertical: 'banking', depth: 1,
      extra: { Amount: '5000', TransactionAmount: '5000', TransactionType: 'create_transfer', TokenScopes: 'transfer' },
    },
  },
  {
    code: 'mcp-user-not-in-group',
    label: 'group membership (UC9)',
    mockRule: 'Rule 3.5b',
    // UserGroups POPULATED with a different group. An empty list is also a mock
    // DENY, but it cannot distinguish "rule enforced" from "attribute ignored".
    deny: {
      tool: 'get_my_accounts', vertical: 'banking', depth: 1,
      extra: { RequiredGroup: 'Premium', UserGroups: '["Standard"]' },
    },
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
    const enforced = r.decision === 'DENY' && codes.includes(rule.code);
    const mismatch = r.decision === 'DENY' && !enforced;
    rows.push({ ...rule, decision: r.decision, codes, enforced, mismatch });
    console.log(
      `  ${enforced ? 'live   ' : 'MISSING'} ${rule.label.padEnd(44)} ${String(r.decision).padEnd(7)}`
      + `[${codes.join('+') || '-'}]${mismatch ? '  <- DENY, but not this rule' : ''}`,
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
  console.log('  The 2026-07-27 import DID land — resource ownership and the A2A nested-');
  console.log('  generalist check went live, and the endpoint returns real statement codes.');
  console.log('  What is missing was never authored cloud-side, so re-importing the same');
  console.log('  snapshot will not fix it. Each rule above needs a condition in the console');
  console.log('  (Authorization Admin role — the demo worker is 403 on the policy APIs).');
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
