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

// Collect every quoted string literal between `createApplication(` /
// `createResourceServer(` and the call's closing `);` — name + description
// are both sent to PingOne verbatim.
function literalsAtCallSites(callPattern) {
  const literals = [];
  lines.forEach((line, i) => {
    if (!callPattern.test(line)) return;
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      const l = lines[j];
      for (const m of l.matchAll(/'((?:[^'\\]|\\.)*)'/g)) literals.push({ line: j + 1, text: m[1] });
      for (const m of l.matchAll(/`([^`]*)`/g)) literals.push({ line: j + 1, text: m[1] });
      if (/\);\s*$/.test(l)) break;
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
    ['createApplication', /this\.createApplication\(\s*$/],
    ['createResourceServer', /this\.createResourceServer\(\s*$/],
  ];

  test.each(callSites)('%s arguments contain only PingOne-accepted chars', (_, pattern) => {
    const literals = literalsAtCallSites(pattern);
    // Guard against vacuous pass: extraction must actually find the call sites.
    expect(literals.length).toBeGreaterThanOrEqual(8);

    const bad = literals.filter((lit) => {
      const cleaned = stripInterp(lit.text);
      return FORBIDDEN.test(cleaned);
    });
    expect(bad).toEqual([]);
  });
});
