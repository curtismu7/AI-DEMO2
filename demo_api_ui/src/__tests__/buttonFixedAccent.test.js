import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Buttons never take a vertical's colour (owner, 2026-11-07: no purple buttons anywhere).
 *
 * Verticals, industry presets and the theme picker write --app-primary-red*, --theme-accent and
 * --brand-* onto <html>. Header, hero and dashboard accents follow them on purpose; a button does
 * not. Button fills, edges and labels read the fixed --btn-accent* tokens declared in index.css.
 */
const SRC = path.resolve(__dirname, '..');
const API = path.resolve(SRC, '..', '..', 'demo_api_server', 'config', 'verticals');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
const rules = (css) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(strip(css)))) out.push({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] });
  return out;
};
const indexCss = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
const ruleFor = (sel) => rules(indexCss).filter((r) => r.sel === sel);

describe('fixed button accent', () => {
  it('declares the fixed tokens on :root', () => {
    const root = rules(indexCss)
      .filter((r) => r.sel === ':root')
      .map((r) => r.body)
      .join('\n');
    for (const t of ['--btn-accent', '--btn-accent-hover', '--btn-accent-edge', '--btn-accent-text', '--btn-accent-gradient']) {
      expect(root, t).toContain(`${t}:`);
    }
    expect(root).toMatch(/--btn-accent-gradient:\s*linear-gradient\(90deg,\s*#d20e0f 55%,\s*#aa0005\)/);
  });

  it('no vertical manifest or industry preset sets a --btn-accent token', () => {
    const files = [
      ...walk(API, 'manifest.json'),
      path.join(SRC, 'config', 'industryPresets.js'),
      path.join(SRC, 'config', 'themeZones.js'),
    ];
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toContain('--btn-accent');
  });

  it('the shared button system reads the fixed tokens, not the vertical-driven ones', () => {
    const sels = [
      '.btn-primary',
      '.btn-primary:hover',
      '.btn-secondary',
      '.btn-secondary:hover',
      '.btn-secondary:focus-visible',
      '.btn-outline-primary',
      '.btn-outline-primary:hover',
      '.hosted-registration__submit',
      '.pagination-btn.active',
    ];
    for (const sel of sels) {
      const found = ruleFor(sel);
      expect(found.length, sel).toBeGreaterThan(0);
      for (const r of found) {
        expect(r.body, sel).not.toMatch(/--app-primary-(red|btn-text)|--theme-accent|--brand-/);
      }
    }
    expect(ruleFor('.btn-primary')[0].body).toContain('var(--btn-accent-gradient)');
  });

  it('a focused secondary button keeps its red label (it was forced to #fff on a white fill)', () => {
    const focus = rules(indexCss).filter((r) => r.sel.includes('.btn-secondary:focus-visible'));
    for (const r of focus) expect(r.body).not.toMatch(/color:\s*#fff/);
  });

  it('no button-like rule in any stylesheet reads --app-primary-red* or --app-primary-btn-text', () => {
    // UserDashboard.css re-binds the red tokens to a fixed blue inside .user-dashboard (not a vertical colour).
    const SKIP_FILES = ['UserDashboard.css', 'SelfServicePage.css'];
    const BUTTONISH = /btn|button|pill|cta|fab|submit|-tab\b|toggle|chip|--on\b|--active/i;
    const offenders = [];
    for (const f of walk(SRC, '.css')) {
      if (SKIP_FILES.some((s) => f.endsWith(s))) continue;
      for (const r of rules(fs.readFileSync(f, 'utf8'))) {
        if (r.sel === ':root' || !BUTTONISH.test(r.sel)) continue;
        if (r.sel.includes('nav-link')) continue; // a text link in the page nav, not a button
        if (/var\(--app-primary-(red|btn-text)/.test(r.body)) {
          offenders.push(`${path.relative(SRC, f)}: ${r.sel.slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard rule resets the vertical-driven tokens on buttons', () => {
    const guard = rules(indexCss).find((r) => r.sel.startsWith(':is(button, .btn,'));
    expect(guard).toBeTruthy();
    for (const t of ['--theme-accent', '--brand-navy', '--app-primary-blue', '--app-primary-red', '--brand-dashboard-header-start']) {
      expect(guard.body, t).toContain(`${t}:`);
    }
  });
});
