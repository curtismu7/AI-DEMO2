'use strict';

/**
 * Chip challenge coverage gate.
 *
 * Every vertical must be able to demonstrate BOTH a consent-only chip (👤) and
 * a both chip (👤🔑), regardless of which vertical is active. This asserts each
 * vertical's manifest carries at least one chip with `challenge: "consent"` and
 * one with `challenge: "both"`. (Phase-2 gate: investment/retail/sporting-goods
 * gain their missing-class chip via a new tool.)
 */
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'config', 'verticals');
const VERTICALS = ['banking', 'government', 'investment', 'healthcare', 'manufacturing', 'university', 'retail', 'workforce', 'sporting-goods'];

function challengesOf(manifest) {
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.id && o.challenge) out.push(o.challenge);
    Object.values(o).forEach(walk);
  })(manifest);
  return new Set(out);
}

describe('chip challenge coverage', () => {
  for (const v of VERTICALS) {
    test(`${v} can demo consent AND both`, () => {
      const m = JSON.parse(fs.readFileSync(path.join(base, v, 'manifest.json'), 'utf8'));
      const kinds = challengesOf(m);
      expect(kinds.has('consent')).toBe(true);
      expect(kinds.has('both')).toBe(true);
    });
  }
});
