import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script
import { planRun, playwrightArgs } from '../../scripts/run-url-smoke.mjs';

/**
 * tests/e2e/url-smoke.spec.js is not in CI, so it rotted: its route list was written in June-August and
 * named 4 of the 43 converted routes while five of its own tests were red. Two guards that DO run in CI:
 * the spec must take its converted routes from scripts/ui-pattern-converted.txt (not a copy), and the npm
 * script must be one command that brings its own dev server.
 */
const UI = path.resolve(__dirname, '..', '..');
const spec = fs.readFileSync(path.join(UI, 'tests/e2e/url-smoke.spec.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(UI, 'package.json'), 'utf8'));

describe('url-smoke spec covers every converted route', () => {
  it('reads the route list from scripts/ui-pattern-converted.txt and loops over it', () => {
    expect(spec).toMatch(/ui-pattern-converted\.txt/);
    expect(spec).toMatch(/for \(const route of CONVERTED_ROUTES\)/);
  });

  it('does not keep a hand-copied list of converted routes', () => {
    const allow = fs
      .readFileSync(path.join(UI, 'scripts/ui-pattern-converted.txt'), 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean);
    // The pre-existing hand lists may mention a converted route (e.g. /privilege-demo) but may not grow into a copy.
    const literal = allow.filter((r) => new RegExp(`['"]${r.replace(/[/.]/g, '\\$&')}['"]`).test(spec));
    expect(literal.length, `hand-copied converted routes: ${literal.join(', ')}`).toBeLessThan(allow.length / 2);
  });
});

describe('npm run test:e2e:smoke', () => {
  it('is the launcher, not a bare playwright call that needs a stack already running on :4000', () => {
    expect(pkg.scripts['test:e2e:smoke']).toBe('node scripts/run-url-smoke.mjs');
  });

  it('starts its own dev server unless the caller points it at one', () => {
    expect(planRun({})).toEqual({ startServer: true });
    expect(planRun({ PLAYWRIGHT_SKIP_WEBSERVER: '1' })).toEqual({ startServer: false });
    expect(planRun({ PLAYWRIGHT_SKIP_WEBSERVER: 'true' })).toEqual({ startServer: false });
    expect(planRun({ PLAYWRIGHT_BASE_URL: 'https://example.test' })).toEqual({ startServer: false });
  });

  it('runs exactly the smoke spec and passes extra arguments through', () => {
    expect(playwrightArgs(['--headed'])).toEqual(['test', 'tests/e2e/url-smoke.spec.js', '--headed']);
  });
});
