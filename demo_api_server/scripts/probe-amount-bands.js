#!/usr/bin/env node
'use strict';
/**
 * probe-amount-bands.js — what gate does the AGENT path actually produce for each
 * transfer amount band?
 *
 * READ-ONLY. Logs in, POSTs four prompts to /api/agent/invoke, prints the reply.
 * It changes no policy, writes no golden, and approves no challenge.
 *
 * WHY THIS EXISTS
 *
 * The four bands are supposed to demo four DIFFERENT controls:
 *
 *   UC22  $150   CIBA out-of-band approval   (declared method, amount-independent)
 *   UC8   $300   HITL consent
 *   UC7   $600   step-up MFA
 *   UC6   $2500  DENY (over the $2,000 ceiling)
 *
 * As of 2026-08-03 the agent path returns `hitl_required` for ALL FOUR — UC6, UC7
 * and UC22 each render UC8's consent message. The direct path is fine: the live
 * PDP denies $2500 and returns a step-up statement at $600, and
 * mcpToolAuthorizationService._applyTransactionPolicy maps those correctly
 * (none/hitl/stepUp/DENY). The BFF gate PERMITs, then the gateway answers 428
 * HITL — see `[mcpGatewayClient] 428 HITL required: tool=create_transfer` in the
 * BFF log — so the amount-band decision never gets to speak on this path.
 *
 * Two candidates, not yet distinguished:
 *   1. mcpToolAuthorizationService.js `if (r.decision === 'DENY' || r.policyNotFound
 *      || r.stepUpRequired) return r;` early-returns BEFORE the forceStepUp branch,
 *      so a delegation result carrying policyNotFound returns its HITL untouched —
 *      which fits all four cases, including why the amount is irrelevant.
 *   2. useCaseId not resolving inside the gate (resolveActiveUseCaseId reads it off
 *      `req`), which would leave getUseCaseStepUpMethod inert. The code comment at
 *      that function says the declared method exists precisely because "the live
 *      P1AZ MCP policy only returns HITL for every amount".
 * One log line at that early return names the culprit; this script shows the
 * before/after in ~20s.
 *
 * WHAT A FIXED RUN LOOKS LIKE — four DIFFERENT outcomes:
 *   UC22  step_up_required        (ciba)
 *   UC8   hitl_required           ← the only one that stays
 *   UC7   step_up_required        (p1mfa)
 *   UC6   authorization_denied
 *
 * USAGE (live stack required):
 *   cd demo_api_server
 *   set -a && . ./.env && set +a
 *   U=demoUser P="$DEMO_USER_PASSWORD" node scripts/probe-amount-bands.js
 *
 * If login fails, try the other password before assuming the build is broken:
 * demoUser's password has been observed flipping between the .env value and
 * `Tigers7&` within an hour, which reads as a broken stack but is not one.
 */

const path = require('path');
const axios = require('axios');
const { loginViaBff } = require(path.join(__dirname, '../tests/real/helpers/session.js'));
const { BFF_BASE, httpsAgent } = require(path.join(__dirname, '../tests/real/helpers/constants.js'));

/** amount -> the control that band is supposed to demonstrate. */
const BANDS = [
  { uc: 'UC22', prompt: 'transfer $150 from checking to savings',  useCaseId: 'ciba-out-of-band-approval', expect: 'step_up_required (ciba)' },
  { uc: 'UC8',  prompt: 'transfer $300 from checking to savings',  useCaseId: 'hitl-consent',              expect: 'hitl_required' },
  { uc: 'UC7',  prompt: 'transfer $600 from checking to savings',  useCaseId: 'step-up-required',          expect: 'step_up_required (p1mfa)' },
  { uc: 'UC6',  prompt: 'transfer $2500 from checking to savings', useCaseId: 'authz-denied',              expect: 'authorization_denied' },
];

(async () => {
  const username = process.env.U || process.env.DEMO_USER_USERNAME || 'demoUser';
  const password = process.env.P || process.env.DEMO_USER_PASSWORD;
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  if (!password || !envId) {
    console.error('Need P (or DEMO_USER_PASSWORD) and PINGONE_ENVIRONMENT_ID. Source demo_api_server/.env first.');
    process.exit(2);
  }

  let jar;
  try {
    const cookies = await loginViaBff({
      envId, region: 'com', username, password,
      loginPath: '/api/auth/oauth/user/login',
      callbackPath: '/api/auth/oauth/user/callback',
    });
    jar = typeof cookies === 'string' ? cookies : (cookies && (cookies.enduser || cookies.cookies)) || '';
  } catch (e) {
    console.error(`login failed: ${e.message}`);
    console.error("If this says 'flow not COMPLETED', the password is wrong — try the other one (see header).");
    process.exit(1);
  }
  console.log(`session: ${jar ? 'ok' : 'FAILED'}  user=${username}`);

  const seen = new Set();
  for (const b of BANDS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await axios.post(
      `${BFF_BASE}/api/agent/invoke`,
      { prompt: b.prompt, forceHeuristic: true, vertical: 'banking', useCaseId: b.useCaseId },
      { headers: { Cookie: jar, 'Content-Type': 'application/json' }, httpsAgent, validateStatus: () => true, timeout: 60_000 },
    );
    const body = r.data || {};
    const got = String(body.error || 'permit');
    seen.add(got);
    console.log(
      `${b.uc.padEnd(5)} http=${String(r.status).padEnd(4)} got=${got.padEnd(22)} want=${b.expect.padEnd(26)} ` +
      `reply=${JSON.stringify(String(body.reply || '').slice(0, 58))}`,
    );
  }

  // The headline: four bands collapsing to one outcome is the bug, and it is easy
  // to miss when skimming four similar-looking lines.
  if (seen.size === 1) {
    console.log(`\nCOLLAPSED — all four bands returned "${[...seen][0]}". Four controls are demoing as one.`);
    process.exitCode = 1;
  } else {
    console.log(`\nDISTINCT — ${seen.size} different outcomes across the four bands.`);
  }
})().catch((e) => {
  console.error('THREW', e.message);
  process.exit(1);
});
