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
    label: 'A2A delegation — act chain depth >= 2',
    mockRule: 'Rule 1c',
    deny: {
      tool: 'sensitive_patient_records', vertical: 'healthcare', depth: 1,
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
    deny: {
      tool: 'get_my_accounts', vertical: 'banking', depth: 1,
      extra: { RequiredGroup: 'Premium', UserGroups: '' },
    },
  },
  {
    code: 'mcp-authorization-denied',
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
    const enforced = r.decision === 'DENY';
    rows.push({ ...rule, decision: r.decision, enforced });
    console.log(
      `  ${enforced ? 'live  ' : 'MISSING'} ${rule.label.padEnd(38)} ${String(r.decision)}   (mock ${rule.mockRule}, code ${rule.code})`,
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
  console.log('  These rules exist in the generated snapshot and run in authz-server, but the');
  console.log('  live decision endpoint permits what they deny. Until the snapshot is imported,');
  console.log('  authz-server is the ONLY place they run — so pointing the Agent Gateway at the');
  console.log('  cloud would remove them while making the demo look more legitimate.');
  console.log('');
  console.log('  Fix (console, needs the Authorization Admin role — the demo worker is 403 on');
  console.log('  the policy APIs): import the reconciled snapshot, then re-run this script.');
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => { console.error('[cloud-parity] failed:', err.message); process.exit(1); });
}

module.exports = { RULES };
