'use strict';
// PingOne rejects app/resource descriptions containing Symbol-category chars
// (e.g. the arrow '→') and the punctuation set $ + < = > ^ ` | ~ — live
// INVALID_DATA seen 2026-10-12: "must contain only Unicode letters, marks,
// numbers, spaces, or punctuation (except $, +, <, =, >, ^, `, |, ~)".
// The failure only surfaces when an app is being CREATED (fresh env or
// recreate-after-drift), so it must be pinned statically, not by dry-run.
//
// Em-dashes (—), bullets (•), curly quotes are Po/Pd punctuation — accepted.

const fs = require('fs');
const path = require('path');

const SERVICE = path.join(__dirname, '../services/pingoneProvisionService.js');
const src = fs.readFileSync(SERVICE, 'utf8');
const lines = src.split('\n');

// Collect every quoted string literal between the matched opening line and the
// block's closing `});` / `);` — name + description are both sent to PingOne
// verbatim.
function literalsAtCallSites(callPattern, maxLines = 14) {
  const literals = [];
  lines.forEach((line, i) => {
    if (!callPattern.test(line)) return;
    for (let j = i; j < Math.min(i + maxLines, lines.length); j++) {
      const l = lines[j];
      for (const m of l.matchAll(/'((?:[^'\\]|\\.)*)'/g)) literals.push({ line: j + 1, text: m[1] });
      for (const m of l.matchAll(/`([^`]*)`/g)) literals.push({ line: j + 1, text: m[1] });
      if (/\);\s*$/.test(l) || /\}\);\s*$/.test(l)) break;
    }
  });
  return literals;
}

// Strip ${...} interpolations — the JS expression is evaluated before the
// string reaches PingOne; only literal text is validated here.
const stripInterp = (s) => s.replace(/\$\{[^}]*\}/g, '');

// Allowed: \w, \s, ASCII punctuation, and the typographic set proven accepted
// live (— – ‘ ’ “ ” • … are Po/Pd punctuation). Everything else fails — the
// arrow '→' is Unicode Symbol category (Po/Pd do not cover it), and live
// INVALID_DATA named it. `+` IS accepted: the live admin app description
// "authorization_code + PKCE" was created successfully.
const FORBIDDEN = /[^\w\s\x20-\x7E -ɏ‐-⁞]/;

describe('PingOne API-bound description literals are ASCII-safe', () => {
  const callSites = [
    ['createApplication', /this\.createApplication\(\s*$/, 14],
    ['createResourceServer', /this\.createResourceServer\(\s*$/, 14],
    // _ensureHostedAccessApp's POST body is a raw makeRequest('/applications')
    // call the helper-based extraction never sees.
    ['makeRequest POST bodies (hosted app)', /makeRequest\('POST', '\/applications', \{$/, 14],
    // Both hosted-access group names + descriptions POST via _ensureGroup.
    ['_ensureGroup arguments (hosted groups)', /this\._ensureGroup\(/, 2],
  ];

  test.each(callSites)('%s contain only PingOne-accepted chars', (_, pattern) => {
    const literals = literalsAtCallSites(pattern);
    // Guard against vacuous pass: extraction must actually find the call sites.
    expect(literals.length).toBeGreaterThanOrEqual(4);

    const bad = literals.filter((lit) => {
      const cleaned = stripInterp(lit.text);
      return FORBIDDEN.test(cleaned);
    });
    expect(bad).toEqual([]);
  });
});
