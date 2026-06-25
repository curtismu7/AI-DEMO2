'use strict';
/**
 * D-A3 maturity probes — jest twin of scripts/check-use-cases-maturity.js.
 * These run as part of the sharded api-server CI job.
 * Each test is SKIPPED (pass) when the target UC is not yet `works`.
 * Each test FAILS when a UC is promoted to `works` without the required code.
 *
 * IMPORTANT: keep patterns and file sets IDENTICAL to the script.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../../');
const { USE_CASES } = require(path.join(ROOT, 'demo_api_server/config/useCases'));

/**
 * Run rg and return total match count.
 * - exit 0: matches found
 * - exit 1: no matches → 0
 * - exit 2: bad path/IO → throws with a clear message
 */
function rgCount(pattern, dirs, extraFlags = '') {
  const absDirs = dirs.map((d) => path.join(ROOT, d));
  const cmd = `rg --count-matches ${extraFlags} ${JSON.stringify(pattern)} ${absDirs.join(' ')}`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().split('\n')
      .map((l) => parseInt(l.split(':').pop(), 10) || 0)
      .reduce((a, b) => a + b, 0);
  } catch (err) {
    if (err.status === 1) { return 0; }
    throw new Error(
      '[maturity-probe] rg error (exit ' + err.status + ') searching [' + dirs.join(', ') + ']: ' + (err.stderr || err.message),
    );
  }
}

describe('D-A3 maturity probes', () => {
  it('P1: useCaseId referenced on non-comment line in buildTokenEvent/logEvent before UC20 claims works', () => {
    const uc20 = USE_CASES.find((u) => u.id === 'UC20');
    if (!uc20 || uc20.maturity !== 'works') return; // skip
    const hits = rgCount(
      '^(?!\\s*(?:\\/\\/|\\*)).*useCaseId',
      [
        'demo_api_server/services/agentMcpTokenService.js',
        'demo_api_server/services/bffMcpToolExecutor.js',
        'demo_api_server/services/appEventService.js',
      ],
      '--pcre2 --multiline',
    );
    expect(hits).toBeGreaterThan(0);
  });

  it('P2: REQUIRE_DPOP_PROOF defaults to true (value immediately after =) before UC12 claims works', () => {
    const uc12 = USE_CASES.find((u) => u.id === 'UC12');
    if (!uc12 || uc12.maturity !== 'works') return; // skip
    const hits = rgCount(
      "^(?!\\s*(?:\\/\\/|\\*)).*REQUIRE_DPOP_PROOF\\s*=\\s*['\"]?true['\"]?",
      ['demo_mcp_gateway/src', 'demo_mcp_server/src'],
      '--pcre2'
    );
    expect(hits).toBeGreaterThan(0);
  });

  it('P3: rate-limiter middleware file with 429 response exists in gateway before UC18 claims works', () => {
    const uc18 = USE_CASES.find((u) => u.id === 'UC18');
    if (!uc18 || uc18.maturity !== 'works') return; // skip

    // (a) middleware file matching /rate/i must exist
    const middlewareDir = path.join(ROOT, 'demo_mcp_gateway/src/middleware');
    let rateLimiterFile = null;
    try {
      const files = fs.readdirSync(middlewareDir);
      rateLimiterFile = files.find((f) => (/rate/i).test(f)) || null;
    } catch (_) {
      rateLimiterFile = null;
    }
    expect(rateLimiterFile).not.toBeNull();

    // (b) that file must contain a 429 response
    const hits = rgCount('429', [path.join('demo_mcp_gateway/src/middleware', rateLimiterFile)]);
    expect(hits).toBeGreaterThan(0);
  });

  it('P4: require-act enforcement (throw/deny on missing act) exists in gateway or authz before UC16 claims works', () => {
    const uc16 = USE_CASES.find((u) => u.id === 'UC16');
    if (!uc16 || uc16.maturity !== 'works') return; // skip
    const hits = rgCount(
      '^(?!\\s*(?:\\/\\/|\\*)).*(requiresAgentMediation|(throw|deny|reject).{0,60}(missing|no|absent)\\s+act(?!_|\\w))',
      ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_authz_server/routes/decision.js'],
      '--pcre2 --multiline --ignore-case',
    );
    expect(hits).toBeGreaterThan(0);
  });

  it('P5: token_lifetime present on non-comment line in oauthService before UC17 claims works', () => {
    const uc17 = USE_CASES.find((u) => u.id === 'UC17');
    if (!uc17 || uc17.maturity !== 'works') return; // skip
    const hits = rgCount(
      '^(?!\\s*(?:\\/\\/|\\*)).*(token_lifetime|tokenLifetime)',
      ['demo_api_server/services/oauthService.js', 'demo_api_server/services/agentMcpTokenService.js'],
      '--pcre2 --multiline',
    );
    expect(hits).toBeGreaterThan(0);
  });
});
