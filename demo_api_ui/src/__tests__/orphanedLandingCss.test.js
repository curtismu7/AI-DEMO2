import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The landing page (LandingPage.js, styled by LandingPage.css under .pu-page.landing-page) no longer sets
 * data-rd-v2, and nothing else renders .landing-* markup, so the old `[data-rd-v2] .landing-*` twin rules in
 * refinedDashboardV2.css and the `.landing-header-actions` overrides in App.css had no consumer. They are gone;
 * this keeps them from coming back by accident.
 */
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('orphaned landing CSS', () => {
  it('refinedDashboardV2.css has no .landing-* rule', () => {
    expect(stripComments(read('../theme/refinedDashboardV2.css'))).not.toMatch(/\.landing-/);
  });

  it('App.css has no .landing-header-actions override', () => {
    expect(stripComments(read('../App.css'))).not.toMatch(/\.landing-header-actions/);
  });

  it('the landing page does not opt into data-rd-v2 (which is what those rules were scoped to)', () => {
    expect(read('../components/LandingPage.js')).not.toMatch(/data-rd-v2/);
  });

  it('no component renders the header/main/footer/logo classes those rules styled', () => {
    const dir = path.resolve(__dirname, '..');
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
        else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
      }
    };
    walk(dir);
    const re = /landing-(header|logo|main|features-heading|footer)\b|\blanding-features\b(?!-)/;
    const hits = files.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(dir, f));
    expect(hits).toEqual([]);
  });
});
