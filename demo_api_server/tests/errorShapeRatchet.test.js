'use strict';

/**
 * Enforces root CLAUDE.md's "Error responses — { error }" rule.
 *
 *   ❌ res.status(400).json({ message: 'bad amount' })
 *   ✅ res.status(400).json({ error: 'bad amount' })
 *
 * Extra fields go ALONGSIDE `error`, never instead of it. 600+ error responses
 * already comply; this stops the count going back up.
 *
 * Allowlisted rather than count-pinned. The four exempt responses are not
 * unmigrated debt — they are deliberate structured signals whose consumers key
 * on their own discriminator, and adding a free-form `error` to them is a
 * behaviour risk, not a cleanup:
 * demo_api_ui/src/services/demoAgentService.js branches on the exact VALUE of
 * `err.error` (=== "hitl_required" / "mcp_hitl_required") to decide "valid
 * consent flow" vs "generic failure", so an unrelated `error` string on a
 * sibling consent shape can misroute a legitimate prompt into error handling.
 * Allowlisting by file+count (not line) survives line drift while still failing
 * on a NEW violation, including one added to an already-listed file.
 *
 * Two false-positive traps this detector is built to avoid, both hit for real
 * while writing it:
 *   1. `message:` occurring INSIDE a string (e.g. "…your message: …") is not an
 *      object key — string/template literals are blanked before matching.
 *      Without this the first version reported 67 hits, nearly all bogus.
 *   2. A non-literal status expression (`res.status(result.statusCode || 403)`)
 *      is still an error response. Matching only literal 4xx/5xx missed a real
 *      violation in routes/apiKeyExchange.js. Any status that is not a literal
 *      2xx/3xx counts.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['routes', 'middleware', 'src'].map((d) => path.join(ROOT, d));

// file -> number of deliberately-exempt responses in it. See header.
const ALLOWLIST = {
  'routes/agentInvokeRoute.js': 1, // 428 requiresConsent — HITL pre-execution gate
  'routes/demoAgentRoutes.js': 1, // 428 requiresConsent — HITL pre-execution gate
  'routes/useCases.js': 2, // 403 decision DENIED / DENY — UC authz decision shape
};

const CALL = /res(?:ponse)?\.status\(([^)]*)\)\s*\.\s*json\(\s*\{([\s\S]*?)\}\s*\)/g;

function jsFiles(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'tests') {
      continue;
    }
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(jsFiles(p));
    else if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) out.push(p);
  }
  return out;
}

// Blank string/template literals so a `message:` inside prose is not read as an
// object key. Length-preserving is unnecessary here; only presence is tested.
function stripLiterals(src) {
  return src.replace(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

function messageWithoutError() {
  const hits = [];
  for (const file of jsFiles(ROOT).filter((f) => SCAN_DIRS.some((d) => f.startsWith(d)))) {
    const raw = fs.readFileSync(file, 'utf8');
    for (const m of raw.matchAll(CALL)) {
      const statusExpr = m[1].trim();
      const literal = /^\d{3}$/.test(statusExpr) ? Number(statusExpr) : null;
      if (literal !== null && literal < 400) continue; // success response

      const body = stripLiterals(m[2]);
      if (!/(?:^|[,{\s])message\s*:/.test(body)) continue;
      if (/(?:^|[,{\s])error\s*:/.test(body)) continue;

      hits.push({
        file: path.relative(ROOT, file),
        line: raw.slice(0, m.index).split('\n').length,
        status: statusExpr,
      });
    }
  }
  return hits;
}

function countByFile(hits) {
  return hits.reduce((acc, h) => {
    acc[h.file] = (acc[h.file] || 0) + 1;
    return acc;
  }, {});
}

describe('error-shape ratchet', () => {
  const hits = messageWithoutError();
  const byFile = countByFile(hits);

  it('no error response returns { message } without { error }, outside the allowlist', () => {
    const offenders = hits
      .filter((h) => (byFile[h.file] || 0) > (ALLOWLIST[h.file] || 0))
      .map((h) => `${h.file}:${h.line} (status ${h.status})`);

    expect(offenders).toEqual([]);
  });

  it('the allowlist is not stale — shrink it when one is fixed', () => {
    const stale = Object.entries(ALLOWLIST)
      .filter(([file, allowed]) => (byFile[file] || 0) < allowed)
      .map(([file, allowed]) => `${file}: allowlisted ${allowed}, found ${byFile[file] || 0}`);

    expect(stale).toEqual([]);
  });
});
