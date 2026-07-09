#!/usr/bin/env node

/*
 * D-A3 maturity probes — 5 concrete checks that prevent silent over-claiming
 * in the use-case catalog maturity tags.
 *
 * Called by the use-cases-docs CI job and available standalone:
 *   node scripts/check-use-cases-maturity.js
 *
 * Uses rg (ripgrep) for all codebase searches. Each probe:
 *   - PASSES silently if the precondition is not met (e.g. UC not yet "works")
 *   - FAILS loudly if a UC is "works" but the required code is absent
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { USE_CASES } = require(path.join(ROOT, 'demo_api_server/config/useCases'));

let failures = 0;

/**
 * Run rg and return total match count.
 * - exit 0: matches found → returns count > 0
 * - exit 1: no matches    → returns 0
 * - exit 2: bad path/IO   → throws with a clear message naming the path
 */
function rg(pattern, dirs, extraFlags = '') {
  const cmd = `rg --count-matches ${extraFlags} ${JSON.stringify(pattern)} ${dirs.join(' ')}`;
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().split('\n')
      .map((l) => parseInt(l.split(':').pop(), 10) || 0)
      .reduce((a, b) => a + b, 0);
  } catch (err) {
    // rg exits 1 when no matches; exits 2 on bad path / I/O error
    if (err.status === 1) return 0;
    throw new Error(
      `[maturity-probe] rg error (exit ${err.status}) searching [${dirs.join(', ')}]: ${err.stderr || err.message}`,
    );
  }
}

function fail(probe, msg) {
  console.error(`[maturity-probe] FAIL ${probe}: ${msg}`);
  failures++;
}

function pass(probe) {
  console.log(`[maturity-probe] PASS ${probe}`);
}

// --- Probe 1 ---
// useCaseId must be referenced in buildTokenEvent / logEvent / bffMcpToolExecutor before
// any UC can claim `works` for audit (UC20 audit-trail).
// Condition fires: UC20 maturity === 'works'
// Required: rg finds 'useCaseId' inside agentMcpTokenService.js, bffMcpToolExecutor.js,
//   or appEventService.js — on a non-comment line.
// IMPORTANT: skip lines whose trimmed text starts with '//' or '*' to avoid comment-only hits.
{
  const uc20 = USE_CASES.find((u) => u.id === 'UC20');
  if (uc20 && uc20.maturity === 'works') {
    // Count only non-comment lines (trimmed line must not start with // or *).
    const nonCommentHits = rg(
      '^(?!\\s*(?:\\/\\/|\\*)).*useCaseId',
      [
        'demo_api_server/services/agentMcpTokenService.js',
        'demo_api_server/services/bffMcpToolExecutor.js',
        'demo_api_server/services/appEventService.js',
      ],
      '--pcre2 --multiline',
    );
    if (nonCommentHits === 0) {
      fail('P1-UC20-audit-trail',
        'UC20 is marked `works` but useCaseId is not referenced on a non-comment line in ' +
        'agentMcpTokenService.js / bffMcpToolExecutor.js / appEventService.js. ' +
        'UC20 requires Plan A Phase A2 (useCaseId plumbing) to be complete before claiming works.');
    } else {
      pass('P1-UC20-audit-trail');
    }
  } else {
    pass('P1-UC20-audit-trail (skipped — UC20 not yet works)');
  }
}

// --- Probe 2 ---
// DPoP `works` requires REQUIRE_DPOP_PROOF to default to true.
// UC12 maturity may be 'works' only when REQUIRE_DPOP_PROOF default is true.
// Condition fires: UC12 maturity === 'works'
// Required: rg finds REQUIRE_DPOP_PROOF immediately followed (no intervening false/comment)
//   by = true in demo_mcp_gateway/src.
// FIX: match REQUIRE_DPOP_PROOF\s*=\s*'?"?true'?"? so 'false // ...true' cannot satisfy.
// Comment-exclusion prefix (same as P1/P4/P5) ensures comment lines cannot match.
{
  const uc12 = USE_CASES.find((u) => u.id === 'UC12');
  if (uc12 && uc12.maturity === 'works') {
    const hits = rg(
      "^(?!\\s*(?:\\/\\/|\\*)).*REQUIRE_DPOP_PROOF\\s*=\\s*['\"]?true['\"]?",
      ['demo_mcp_gateway/src', 'demo_mcp_server/src'],
      '--pcre2'
    );
    if (hits === 0) {
      fail('P2-UC12-dpop',
        'UC12 is marked `works` but REQUIRE_DPOP_PROOF default-true was not found in gateway/server source. ' +
        'DPoP is off by default (REQUIRE_DPOP_PROOF=false). Set the default to true before claiming works.');
    } else {
      pass('P2-UC12-dpop');
    }
  } else {
    pass('P2-UC12-dpop (skipped — UC12 not yet works)');
  }
}

// --- Probe 3 ---
// UC18 `works` requires a REAL rate-limit middleware file to exist in the gateway.
// Condition fires: UC18 maturity === 'works'
// Required:
//   (a) A file matching demo_mcp_gateway/src/middleware/rate* (or *rate*) must exist, AND
//   (b) That file must contain a 429 response.
// A bare '429' grep across all of src must NOT satisfy it — prevents false-pass on the
// retry-guard string in GatewayIntrospectionClient.ts.
{
  const uc18 = USE_CASES.find((u) => u.id === 'UC18');
  if (uc18 && uc18.maturity === 'works') {
    const rateLimitModule = path.join(ROOT, 'demo_mcp_gateway/src/rateLimit.ts');
    const authorizeMiddleware = path.join(ROOT, 'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts');
    const hasRateModule = fs.existsSync(rateLimitModule);
    const hits429 = rg('429', [authorizeMiddleware]);
    if (!hasRateModule || hits429 === 0) {
      fail('P3-UC18-rate-limit',
        'UC18 is marked `works` but gateway rate-limiting is incomplete. ' +
        'Expected demo_mcp_gateway/src/rateLimit.ts and a 429 response in authorizeMcpRequest.ts.');
    } else {
      pass('P3-UC18-rate-limit');
    }
  } else {
    pass('P3-UC18-rate-limit (skipped — UC18 not yet works)');
  }
}

// --- Probe 4 ---
// UC16 `works` requires the require-act rule to enforce REJECTION when act is absent.
// Condition fires: UC16 maturity === 'works'
// Required: rg finds a throw/deny/reject keyed on missing/absent act — specifically
//   requiresAgentMediation OR (throw|deny|reject).*(missing|no|absent).*act
//   on a NON-COMMENT line in GatewayTokenPolicy.ts or decision.js.
// Comments and log/label strings must NOT satisfy this — the match must be code.
{
  const uc16 = USE_CASES.find((u) => u.id === 'UC16');
  if (uc16 && uc16.maturity === 'works') {
    // Pattern matches requiresAgentMediation OR a throw/deny/reject keyed on a missing/absent
    // act CLAIM (the top-level delegation claim) — not may_act (a different attribute).
    // Excludes comment-only lines and any hit that is about may_act rather than act.
    const hits = rg(
      '^(?!\\s*(?:\\/\\/|\\*)).*(requiresAgentMediation|(throw|deny|reject).{0,60}(missing|no|absent)\\s+act(?!_|\\w))',
      ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_authz_server/routes/decision.js'],
      '--pcre2 --multiline --ignore-case',
    );
    if (hits === 0) {
      fail('P4-UC16-require-act',
        'UC16 is marked `works` but no enforcement found that REJECTS when act is absent. ' +
        'Needed: requiresAgentMediation OR a throw/deny/reject on missing/no act in ' +
        'GatewayTokenPolicy.ts or decision.js (on a non-comment line). ' +
        'Pure impersonation is currently ALLOWED (act is optional). Enforcement requires Plan C, NNP-4/C4.');
    } else {
      pass('P4-UC16-require-act');
    }
  } else {
    pass('P4-UC16-require-act (skipped — UC16 not yet works)');
  }
}

// --- Probe 5 ---
// UC17 `works` requires a token-TTL source to exist.
// Condition fires: UC17 maturity === 'works'
// Required: rg finds 'token_lifetime' or 'tokenLifetime' on a non-comment line in
//   oauthService.js (performTokenExchange) or agentMcpTokenService.js.
// Comment-only hits are excluded so a planning note cannot satisfy the gate.
{
  const uc17 = USE_CASES.find((u) => u.id === 'UC17');
  if (uc17 && uc17.maturity === 'works') {
    const hits = rg(
      '^(?!\\s*(?:\\/\\/|\\*)).*(token_lifetime|tokenLifetime)',
      ['demo_api_server/services/oauthService.js', 'demo_api_server/services/agentMcpTokenService.js'],
      '--pcre2 --multiline',
    );
    if (hits === 0) {
      fail('P5-UC17-jit-ttl',
        'UC17 is marked `works` but no token_lifetime / tokenLifetime found on a non-comment line ' +
        'in oauthService.js or agentMcpTokenService.js. ' +
        'performTokenExchange currently sends no token_lifetime; the TTL is whatever PingOne issues. ' +
        'Add an explicit short TTL before claiming works (Plan C, C7).');
    } else {
      pass('P5-UC17-jit-ttl');
    }
  } else {
    pass('P5-UC17-jit-ttl (skipped — UC17 not yet works)');
  }
}

// --- Summary ---
if (failures > 0) {
  console.error(`\n[maturity-probe] ${failures} probe(s) FAILED — catalog maturity tags are ahead of the code.`);
  process.exit(1);
}
console.log('\n[maturity-probe] All 5 probes passed.');
