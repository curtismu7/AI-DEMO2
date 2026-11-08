import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script shared with CI (npm run check:ui-patterns)
import {
  checkPage,
  runAll,
  loadRoutes,
  loadAllowlist,
  readPage,
  isVioletIndigo,
  violetLiterals,
  colourFunctionToRgb,
  lengthToPx,
  expandVars,
  buttonClasses,
  parseCss,
  loadGlobalTokens,
  SHARED_FILES,
} from '../../scripts/check-ui-patterns.mjs';

/**
 * Ping UI Standard ratchet: every route listed in scripts/ui-pattern-converted.txt must keep passing
 * the static pattern check (banner first, one primary button, chips carry text, no inline colour,
 * no violet/indigo or vertical colour on buttons, 10px floor). All other pages are advisory.
 * The mutation cases prove each rule can fail, so a green run is not vacuous. The shared stylesheet and
 * components are one more rule set, enforced whatever the allowlist says. End-to-end mutations (a temp copy
 * of the page and shared files, run through the real script) live in uiPatternsMutation.test.js.
 */
const drifted = (results) => results.filter((r) => r.status === 'DRIFT').map((r) => r.rule);

const saasFile = loadRoutes()['/privilege-saas-access'];
const saas = readPage(saasFile);
const cssWith = (extra) => [{ file: 'x.css', css: `${saas.css[0].css}\n${extra}` }];

describe('ui pattern check', () => {
  it('every allowlisted route resolves to a page and passes all rules', () => {
    const allowlist = loadAllowlist();
    expect(allowlist.length).toBeGreaterThan(0);
    const { pages, missing } = runAll({ allowlist });
    expect(missing, 'allowlisted routes with no <Route> in App.js').toEqual([]);
    const failing = pages.filter((p) => p.enforced && p.failed.length);
    const msg = failing.map((p) => `${p.routes.join(',')} ${p.failed.map((f) => `${f.rule}: ${f.detail}`).join(' | ')}`).join('\n');
    expect(failing.length, `enforced pages drifted:\n${msg}`).toBe(0);
  });

  it('the shared stylesheet and components pass as their own rule set', () => {
    const { shared } = runAll();
    expect(shared.failed.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
    for (const f of [...SHARED_FILES, 'src/components/pingUi/index.jsx']) expect(shared.files).toContain(f);
  });

  it('starts with the SaaS Access page and nothing else is enforced silently', () => {
    expect(loadAllowlist()).toContain('/privilege-saas-access');
    expect(Object.keys(loadRoutes()).length).toBeGreaterThan(50);
  });

  it('the converted page passes as published', () => {
    expect(drifted(checkPage(saas))).toEqual([]);
  });

  it('fails when a second primary button appears', () => {
    const jsx = saas.jsx.replace('className="pu-btn" onClick={reset}', 'className="pu-btn pu-btn--primary" onClick={reset}');
    expect(jsx).not.toBe(saas.jsx);
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('counts the live-check default trigger (btn-primary) as a primary', () => {
    const jsx = saas.jsx.replace('buttonClassName="pu-btn"', '');
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('fails on a chip with no text, whether StatusChip or a chip class', () => {
    const a = saas.jsx.replace('<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info" />');
    expect(drifted(checkPage({ jsx: a, css: saas.css }))).toEqual(['P7 chips carry text']);
    const b = saas.jsx.replace(
      '<StatusChip tone="info">Live call</StatusChip>',
      '<span className="pu-chip pu-chip--info"><span className="pu-chip__dot" aria-hidden="true" /></span>',
    );
    expect(drifted(checkPage({ jsx: b, css: saas.css }))).toEqual(['P7 chips carry text']);
  });

  it('fails on an indigo/violet button literal and on a vertical colour token on a button', () => {
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: #4f46e5; }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: var(--app-primary-red); }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    // A non-button rule may still use a vertical colour (card edges do).
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-card { border-top-color: var(--app-primary-red); }') }))).toEqual([]);
  });

  it('fails on inline colour, a font under 10px, and a banner that is not first', () => {
    const inline = saas.jsx.replace('<p className="psa-justification">', '<p className="psa-justification" style={{ color: "#333" }}>');
    expect(drifted(checkPage({ jsx: inline, css: saas.css }))).toEqual(['H3 no inline colour']);
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-tiny { font-size: 9px; }') }))).toEqual(['H2 10px font floor']);
    const noBanner = saas.jsx.replace(/<SimBanner[\s\S]*?<\/SimBanner>/, '');
    expect(drifted(checkPage({ jsx: noBanner, css: saas.css }))).toEqual(['P2 banner first']);
  });

  it('ignores commented-out violations', () => {
    const jsx = `${saas.jsx}\n// <button className="pu-btn--primary">x</button>\n/* style={{ color: '#fff' }} */`;
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual([]);
  });

  it('classifies violet and indigo but not Ping blue, red or green', () => {
    expect(isVioletIndigo([0x4f, 0x46, 0xe5])).toBe(true);
    expect(isVioletIndigo([0x6d, 0x28, 0xd9])).toBe(true);
    expect(isVioletIndigo([0x12, 0x53, 0x8d])).toBe(false);
    expect(isVioletIndigo([0xd2, 0x0e, 0x0f])).toBe(false);
    expect(violetLiterals('linear-gradient(90deg, #d20e0f 55%, #aa0005)')).toEqual([]);
  });

  it('the shared stylesheet is imported once, from the entry', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '..', 'index.jsx'), 'utf8');
    expect(entry.match(/styles\/ping-ui\.css/g)).toHaveLength(1);
  });

  it('normalises hsl, hwb, oklch, oklab, lab, lch, color() and named colours before the hue test', () => {
    for (const v of [
      'hsl(250 80% 50%)',
      'hsl(250deg, 80%, 50%)',
      'hwb(260 10% 20%)',
      'oklch(0.5 0.2 285)',
      'oklab(0.5 0.1 -0.2)',
      'lab(40 40 -60)',
      'lch(40 60 300)',
      'color(srgb 0.4 0.2 0.9)',
      'plum',
      'navy',
      'linear-gradient(90deg, color-mix(in srgb, #4f46e5 60%, white), red)',
    ]) expect(violetLiterals(v), v).not.toEqual([]);
    for (const v of ['hsl(209 77% 31%)', 'hsl(250 20% 8%)', 'oklch(0.55 0.22 27)', 'lch(50 60 30)', 'red', 'var(--th-text)', 'url(violet.png)']) {
      expect(violetLiterals(v), v).toEqual([]);
    }
    expect(colourFunctionToRgb('hsl(250 80% 50%)')).toEqual([60, 25, 230]);
  });

  it('resolves var() chains through every definition and flags a vertical token in the chain', () => {
    const tokens = parseCss(':root { --a: var(--b); --b: #4f46e5; } .x { --c: var(--app-primary-red, red); }').reduce((m, r) => {
      for (const [k, v] of r.decls) m.set(k, new Set([...(m.get(k) || []), v]));
      return m;
    }, new Map());
    expect(expandVars('var(--a)', tokens).values).toEqual(['#4f46e5']);
    expect(expandVars('var(--c)', tokens).vertical).toBe(true);
    expect(expandVars('var(--nope, 9px)', tokens).values).toEqual(['9px']);
  });

  it('reads sizes in px, rem, em, pt, %, keywords, clamp/min/max/calc against the 10px floor', () => {
    expect([lengthToPx('9px'), lengthToPx('0.5rem'), lengthToPx('6pt'), lengthToPx('xx-small')]).toEqual([9, 8, 8, 9]);
    expect(lengthToPx('10px')).toBe(10);
    expect(lengthToPx('0.625rem')).toBe(10);
    expect(lengthToPx('62.5%')).toBe(10);
    expect(lengthToPx('clamp(8px, 2vw, 14px)')).toBe(8);
    expect(lengthToPx('calc(0.5rem + 1px)')).toBe(9);
    expect(lengthToPx('2vw')).toBeNull();
  });

  it('parses CSS nesting, @media and url() values with semicolons', () => {
    const rules = parseCss('.a { color: red; .b { color: blue } & .c { color: green } @media (x) { color: plum } background: url(data:image/png;base64,AAA); }');
    const sel = rules.map((r) => r.selector);
    expect(sel).toEqual(expect.arrayContaining(['.a', '.a .b', '.a .c']));
    expect(rules.filter((r) => r.selector === '.a').flatMap((r) => r.decls.map((d) => d[0]))).toEqual(expect.arrayContaining(['color', 'background']));
    expect(rules.flatMap((r) => r.decls).find((d) => d[0] === 'background')[1]).toBe('url(data:image/png;base64,AAA)');
  });

  it('treats a class the JSX puts on a button as a button selector, whatever it is called', () => {
    const jsx = '<button type="button" className="psa-go">Go</button><a className="btn psa-link" href="/x">x</a><div className="psa-card" />';
    expect([...buttonClasses(jsx)].sort()).toEqual(['btn', 'psa-go', 'psa-link']);
    const r = checkPage({ jsx: saas.jsx + jsx, css: cssWith('.psa-go { background: hsl(250 80% 50%); } .psa-card { background: hsl(250 80% 50%); }') });
    expect(drifted(r)).toEqual(['P9 no violet/indigo or vertical colour on buttons']);
  });

  it('follows the font shorthand and a var() size', () => {
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-tiny { font: italic 700 9px/1.2 sans-serif; }') }))).toEqual(['H2 10px font floor']);
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-ok { font: 700 10px/1.2 sans-serif; }') }))).toEqual([]);
    const tokens = loadGlobalTokens();
    expect(tokens.get('--btn-accent')).toBeTruthy();
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-tiny { font-size: var(--font-size-3xs); }'), tokens }))).toEqual([]);
  });
});
