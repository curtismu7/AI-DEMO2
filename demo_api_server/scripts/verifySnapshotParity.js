#!/usr/bin/env node
'use strict';
/**
 * verifySnapshotParity.js — has the LIVE policy diverged from the snapshot in
 * this repo?
 *
 * TECH_DEBT 2026-08-17 closed with a residual note: "nothing in the repo can
 * tell that the live environment has diverged", and the only reason we ever
 * knew the environment agreed was that someone ran a script by hand and read
 * the output. This makes divergence a REPORTED CONDITION with an exit code.
 *
 * WHAT THIS IS NOT. `verify:authorize-parity` already probes seven authored
 * rules and proves the live policy enforces them. It is hand-maintained: a
 * rule added to the snapshot does not add a probe, so its coverage silently
 * decays. This script checks the two things that one cannot:
 *
 *   1. OFFLINE — every DENY statement code the snapshot authors is actually
 *      probed by verify:authorize-parity, and every code it probes still
 *      exists in the snapshot. Answers "is the live check still complete?".
 *      Runs anywhere, no credentials, safe in CI.
 *
 *   2. LIVE — the request-attribute contract holds against the running
 *      environment. A control request built from the contract must not return
 *      INDETERMINATE. It does when the live policy carries a condition-read
 *      attribute with no default — which is exactly the shape of "live is an
 *      OLDER policy than the snapshot in this repo", since the repo's standing
 *      fix for that class is to give the attribute an inert default
 *      (Amount, RarMaxAmount, TransactionType). Skipped without credentials.
 *
 * Exit codes: 0 = in parity (or offline-only and clean), 1 = diverged.
 *
 * Usage:  npm --prefix demo_api_server run verify:snapshot-parity
 *         node demo_api_server/scripts/verifySnapshotParity.js --offline
 */

require('./loadDemoEnv').loadDemoEnv();

const { contract, loadSnapshot } = require('../../snapshots/p1azRequestContract');

const OFFLINE_ONLY = process.argv.includes('--offline');

/** DENY statement codes the snapshot authors. */
function snapshotDenyCodes() {
  return [...new Set(
    loadSnapshot()
      .filter((o) => o && o.type === 'Statement' && o.appliesTo === 'DENY' && o.code)
      .map((o) => o.code),
  )].sort();
}

/** DENY codes the live rule-parity probe covers. */
function probedCodes() {
  const { RULES } = require('./verifyAuthorizeCloudParity');
  return [...new Set(RULES.map((r) => r.code))].sort();
}

function reportOffline() {
  const failures = [];

  // 1a) the request-attribute invariant (the offline half of the contract)
  const c = contract();
  if (c.mustSend.length > 0) {
    failures.push(
      `snapshot has condition-read attribute(s) with NO default: ${c.mustSend.join(', ')}. ` +
      'Live P1AZ answers INDETERMINATE for the whole decision when a request omits one.',
    );
  }
  console.log(`[parity] request attributes: ${c.all.length} total, ${c.inert.length} condition-read (all defaulted), ${c.unread.length} reportable-only`);

  // 1b) probe coverage vs authored statements
  const authored = snapshotDenyCodes();
  const probed = probedCodes();
  const unprobed = authored.filter((code) => !probed.includes(code));
  const stale = probed.filter((code) => !authored.includes(code));

  console.log(`[parity] deny codes: ${authored.length} authored in the snapshot, ${probed.length} probed live by verify:authorize-parity`);

  if (stale.length) {
    failures.push(
      `verify:authorize-parity probes deny code(s) the snapshot no longer defines: ${stale.join(', ')}. ` +
      'The probe would report a live rule as MISSING that this repo never authored.',
    );
  }
  if (unprobed.length) {
    // Not every authored statement is a rule worth probing live (some are advice
    // payloads on pause paths), so this reports rather than fails — but it is
    // printed every run so the coverage gap cannot go unnoticed the way it did.
    console.log(`[parity] NOTE — ${unprobed.length} authored deny code(s) have no live probe:`);
    for (const code of unprobed) console.log(`           ${code}`);
    console.log('         Add a row to RULES in verifyAuthorizeCloudParity.js to cover one.');
  }

  return failures;
}

async function reportLive() {
  const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID;
  const CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID;
  const CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET;
  if (!ENV_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.log('\n[parity] LIVE half SKIPPED — no PINGONE_ENVIRONMENT_ID / _WORKER_CLIENT_ID / _WORKER_CLIENT_SECRET.');
    console.log('         Offline result above stands; divergence from the live policy is UNTESTED.');
    return [];
  }

  const { decide, params, workerToken } = require('./verifyA2aDelegationPolicy');
  console.log(`\n[parity] live env=${ENV_ID}`);

  const token = await workerToken();
  // A read tool at depth 1: the control shape verify:authorize-parity uses, and
  // the one that must always PERMIT. INDETERMINATE here means an attribute went
  // unresolved live — the divergence this script exists to catch.
  const control = params({ tool: 'get_my_accounts', depth: 1, vertical: 'banking' });
  const res = await decide(token, control);
  const codes = ((res.body && res.body.statements) || []).map((s) => s.code).filter(Boolean);

  console.log(`[parity] control decision=${res.decision || '(none)'} status=${res.status} statements=[${codes.join(', ') || '-'}]`);

  if (res.decision === 'INDETERMINATE') {
    return [
      'LIVE policy returned INDETERMINATE for the control request. The live Trust Framework has a ' +
      'condition-read attribute with no default that this snapshot has since defaulted — i.e. the ' +
      'imported policy is OLDER than snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json. ' +
      'Re-import the snapshot through the PingOne console.',
    ];
  }
  if (res.decision !== 'PERMIT') {
    return [
      `LIVE control request returned ${res.decision || `HTTP ${res.status}`} rather than PERMIT. ` +
      'Either the environment is not evaluating normally or the live policy denies a plain read — ' +
      'both mean the live policy does not match this repo.',
    ];
  }
  console.log('[parity] live control PERMITs — the request-attribute contract holds against this environment.');
  return [];
}

async function main() {
  console.log('[parity] snapshot ↔ live policy parity\n');
  const failures = reportOffline();
  if (!OFFLINE_ONLY) failures.push(...await reportLive());

  if (failures.length) {
    console.error('\n[parity] DIVERGED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n[parity] PASS — no divergence detected.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[parity] ERROR — ${err.message}`);
    process.exit(1);
  });
}

module.exports = { snapshotDenyCodes, probedCodes };
