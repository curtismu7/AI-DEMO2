'use strict';

/**
 * Chip challenge coverage gate.
 *
 * Every vertical must be able to demonstrate BOTH a consent-only chip (👤) and
 * an MFA chip (🔑 step_up, or legacy both 👤🔑), regardless of which vertical
 * is active. Primary rail uses consent + step_up; Advanced may keep `both`
 * for CIBA-style combined demos.
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
    test(`${v} can demo consent AND MFA (step_up or both)`, () => {
      const m = JSON.parse(fs.readFileSync(path.join(base, v, 'manifest.json'), 'utf8'));
      const kinds = challengesOf(m);
      expect(kinds.has('consent')).toBe(true);
      expect(kinds.has('step_up') || kinds.has('both')).toBe(true);
    });
  }
});
